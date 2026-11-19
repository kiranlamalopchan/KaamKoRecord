"""Private CSV catalogues. Web and native clients use the same import rules."""
import csv
import io
from pathlib import Path
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Case, IntegerField, Value, When
from django.core.exceptions import ValidationError
from django.utils import timezone
from django.http import Http404

from .models import Catalogue, CatalogueUpload, PluItem

MAX_BYTES = 10 * 1024 * 1024
MAX_ROWS = 20000
SEARCH_PAGE_SIZE = 5
LIST_PAGE_SIZE = 30
MAX_COLUMNS = 50
UPLOAD_TTL = timedelta(hours=1)


class CatalogueProblem(ValueError):
    pass


def items_for(user, catalogue_id=None):
    qs = PluItem.objects.filter(catalogue__owner=user)
    return qs.filter(catalogue_id=catalogue_id) if catalogue_id is not None else qs


def catalogues_for(user):
    return Catalogue.objects.filter(owner=user).order_by("name", "pk")


def catalogue_choices(user):
    return list(catalogues_for(user).annotate(count=Count("items")).values("id", "name", "count"))


def select_catalogue(user, catalogue_id=None):
    if catalogue_id in (None, ""):
        return Catalogue.objects.filter(owner=user).order_by("pk").first()
    try:
        chosen = Catalogue.objects.filter(owner=user, pk=int(catalogue_id)).first()
    except (ValueError, TypeError, OverflowError):
        chosen = None
    if chosen is None:
        raise Http404("Catalogue not found.")
    return chosen


def for_request(request):
    if hasattr(request, "_item_catalogue"):
        return request._item_catalogue
    value = request.GET.get("catalogue") or request.POST.get("catalogue")
    if not value and hasattr(request, "data"):
        value = request.data.get("catalogue")
    if value:
        chosen = select_catalogue(request.user, value)
    elif hasattr(request, "session") and not request.path.startswith("/api/"):
        saved = request.session.get("item_catalogue")
        chosen = Catalogue.objects.filter(owner=request.user, pk=saved).first() if saved else None
        chosen = chosen or select_catalogue(request.user)
    else:
        chosen = select_catalogue(request.user)
    request._item_catalogue = chosen
    if chosen and hasattr(request, "session") and not request.path.startswith("/api/"):
        request.session["item_catalogue"] = chosen.pk
    return chosen


def selected_items(request):
    chosen = for_request(request)
    return items_for(request.user, chosen.pk) if chosen else items_for(request.user).none()


def settings_for(user):
    return select_catalogue(user)


def configuration(catalogue):
    if not catalogue:
        return None
    return {"id": catalogue.pk, "name": catalogue.name, "headers": catalogue.headers,
            "title_column": catalogue.title_column, "description_column": catalogue.description_column,
            "code_column": catalogue.code_column, "search_columns": catalogue.search_columns,
            "track_stock": catalogue.track_stock}


def item_data(item):
    return {"id": item.pk, "catalogue_id": item.catalogue_id, "title": item.title, "description": item.description,
            "code": item.code, "fields": item.fields, "stock": item.stock}


def clean_name(name):
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
        raise CatalogueProblem("Give your catalogue a name of up to 100 characters.")
    return name.strip()


def clean_headers(headers):
    if not isinstance(headers, list) or not headers:
        raise CatalogueProblem("Add at least one column.")
    cleaned = [h.strip() if isinstance(h, str) else "" for h in headers]
    if any(not h or len(h) > 100 for h in cleaned):
        raise CatalogueProblem("Give every column a name of up to 100 characters.")
    if len(cleaned) > MAX_COLUMNS or len({h.casefold() for h in cleaned}) != len(cleaned):
        raise CatalogueProblem("Use up to 50 columns, each with a different name.")
    return cleaned


def plu_number(code_column, code):
    """Numeric PLU matching stays available for a catalogue whose code column is plu_no."""
    if code_column.casefold() in ("plu_no", "plu") and code.isdigit() and int(code) <= 2147483647:
        return int(code)
    return None


@transaction.atomic
def create_catalogue(user, data):
    """A catalogue made in the app: a name and the columns, items added one at a time."""
    if not isinstance(data, dict):
        raise CatalogueProblem("Give your catalogue a name and its columns.")
    get_user_model().objects.select_for_update().get(pk=user.pk)
    name = clean_name(data.get("name"))
    if catalogues_for(user).filter(name__iexact=name).exists():
        raise CatalogueProblem("You already have a catalogue with that name.")
    headers = clean_headers(data.get("headers"))
    title = data.get("title_column") or headers[0]
    code = data.get("code_column") or ""
    if title not in headers or (code and code not in headers) or (code and code == title):
        raise CatalogueProblem("Choose the name and barcode columns from your columns.")
    return Catalogue.objects.create(owner=user, name=name, headers=headers, title_column=title,
        description_column="", code_column=code, search_columns=headers, track_stock=data.get("track_stock") is True)


@transaction.atomic
def update_catalogue(user, catalogue_id, changes):
    if not isinstance(changes, dict):
        raise CatalogueProblem("Provide catalogue settings to update.")
    get_user_model().objects.select_for_update().get(pk=user.pk)
    chosen = select_catalogue(user, catalogue_id)
    name = clean_name(changes.get("name", chosen.name))
    if catalogues_for(user).exclude(pk=chosen.pk).filter(name__iexact=name).exists():
        raise CatalogueProblem("You already have a catalogue with that name.")
    headers = chosen.headers
    added = []
    if "headers" in changes:
        # Columns can be added, never taken away: every item keeps all it has.
        headers = clean_headers(changes["headers"])
        if any(h not in headers for h in chosen.headers):
            raise CatalogueProblem("Columns can be added but not removed.")
        added = [h for h in headers if h not in chosen.headers]
    selected = changes.get("search_columns", chosen.search_columns + added)
    if not isinstance(selected, list) or not selected or any(h not in headers for h in selected):
        raise CatalogueProblem("Choose at least one searchable column from this catalogue.")
    selected = list(dict.fromkeys(selected))
    code = changes.get("code_column", chosen.code_column) or ""
    if code and (code not in headers or code == chosen.title_column):
        raise CatalogueProblem("Choose a barcode column other than the name column.")

    if selected != chosen.search_columns or code != chosen.code_column:
        items = list(chosen.items.all())
        if code != chosen.code_column:
            seen = {}
            for item in items:
                value = str(item.fields.get(code, "")).strip() if code else ""
                if len(value) > 100:
                    raise CatalogueProblem("Barcodes can have up to 100 characters. Choose another column.")
                if value and value in seen:
                    raise CatalogueProblem(f"The code {value!r} appears more than once in that column. Choose another column.")
                seen[value] = True
                item.code, item.plu_no = value, plu_number(code, value)
        numbers = [i.plu_no for i in items if i.plu_no is not None]
        if len(numbers) != len(set(numbers)):
            raise CatalogueProblem("Two PLU codes have the same numeric value. Choose another column.")
        for item in items:
            item.search_text = "\n".join(str(item.fields.get(h, "")) for h in selected)
        PluItem.objects.bulk_update(items, ["search_text", "code", "plu_no"], batch_size=500)
    track = changes.get("track_stock", chosen.track_stock)
    if not isinstance(track, bool):
        raise CatalogueProblem("Choose whether to count stock.")
    chosen.name, chosen.headers, chosen.search_columns, chosen.code_column, chosen.track_stock = name, headers, selected, code, track
    chosen.save(update_fields=["name", "headers", "search_columns", "code_column", "track_stock"])
    return chosen


def item_list(user, catalogue_id):
    chosen = select_catalogue(user, catalogue_id)
    return chosen, chosen.items.order_by("title", "pk")


@transaction.atomic
def save_item(user, catalogue_id, values, item_id=None):
    """Add one item, or change one, from {column: value}. Columns left out keep what they had."""
    if not isinstance(values, dict):
        raise CatalogueProblem("Fill in the item's details.")
    chosen = Catalogue.objects.select_for_update().filter(owner=user, pk=catalogue_id).first()
    if chosen is None:
        raise Http404("Catalogue not found.")
    item = None
    if item_id is not None:
        item = chosen.items.filter(pk=item_id).first()
        if item is None:
            raise Http404("Item not found.")
    fields = dict(item.fields) if item else {}
    for header in chosen.headers:
        value = values.get(header, fields.get(header, ""))
        if value is None:
            value = ""
        if not isinstance(value, (str, int, float)) or isinstance(value, bool):
            raise CatalogueProblem(f"Enter {header} as text.")
        value = str(value).strip()
        if len(value) > 10000:
            raise CatalogueProblem(f"{header} can have up to 10,000 characters.")
        fields[header] = value
    title = fields.get(chosen.title_column, "")
    if not title:
        raise CatalogueProblem(f"Enter the {chosen.title_column}.")
    code = fields.get(chosen.code_column, "") if chosen.code_column else ""
    if len(code) > 100:
        raise CatalogueProblem("Barcodes can have up to 100 characters.")
    others = chosen.items.exclude(pk=item.pk) if item else chosen.items.all()
    if code and others.filter(code=code).exists():
        raise CatalogueProblem(f"Another item already has the code {code}.")
    number = plu_number(chosen.code_column, code) if code else None
    if number is not None and others.filter(plu_no=number).exists():
        raise CatalogueProblem(f"Another item already has the PLU {number}.")
    item = item or PluItem(catalogue=chosen)
    item.fields, item.title, item.code, item.plu_no = fields, title, code, number
    item.description = (fields.get(chosen.description_column) if chosen.description_column else "") or title
    item.search_text = "\n".join(str(fields.get(h, "")) for h in chosen.search_columns)
    item.save()
    return item


MAX_STOCK = 1_000_000_000


def whole_number(value, problem):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise CatalogueProblem(problem)
    try:
        number = int(str(value).strip())
    except ValueError:
        raise CatalogueProblem(problem)
    if abs(number) > MAX_STOCK:
        raise CatalogueProblem(problem)
    return number


@transaction.atomic
def change_stock(user, item_id, change=None, count=None):
    """Add to or take from an item's stock, or set it after a count. Two phones
    scanning the same item at once both count: the row is locked while it changes."""
    item = items_for(user).select_for_update().select_related("catalogue").filter(pk=item_id).first()
    if item is None:
        raise Http404("Item not found.")
    if not item.catalogue.track_stock:
        raise CatalogueProblem("Turn on stock counting for this catalogue first.")
    if count not in (None, ""):
        item.stock = whole_number(count, "Enter the stock as a whole number.")
    else:
        item.stock += whole_number(change, "Enter the change as a whole number.")
    if abs(item.stock) > MAX_STOCK:
        raise CatalogueProblem("That stock is too large.")
    item.save(update_fields=["stock"])
    return item


@transaction.atomic
def delete_item(user, item_id):
    item = items_for(user).select_for_update().filter(pk=item_id).first()
    if item is None:
        raise Http404("Item not found.")
    item.delete()


@transaction.atomic
def delete_catalogue(user, catalogue_id):
    get_user_model().objects.select_for_update().get(pk=user.pk)
    chosen = select_catalogue(user, catalogue_id)
    chosen.delete()


def search_items(user, query, catalogue_id=None):
    chosen = select_catalogue(user, catalogue_id)
    qs = items_for(user, chosen.pk) if chosen else items_for(user).none()
    # A word may occur in any selected field; all words must be present.
    for word in query.split():
        qs = qs.filter(search_text__icontains=word)
    return qs.annotate(rank=Case(
        When(code__iexact=query, then=Value(0)),
        When(title__iexact=query, then=Value(1)),
        When(title__istartswith=query, then=Value(2)),
        default=Value(3), output_field=IntegerField(),
    )).order_by("rank", "title", "pk")


def stage_upload(user, upload):
    if upload is None:
        raise CatalogueProblem("Choose a CSV file to upload.")
    if not upload.name.lower().endswith(".csv"):
        raise CatalogueProblem("Choose a .csv file. Export your spreadsheet as CSV first.")
    raw = upload.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise CatalogueProblem("Choose a CSV smaller than 10 MB.")
    try:
        text = raw.decode("utf-8-sig")
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t")
    except UnicodeDecodeError:
        raise CatalogueProblem("Save your CSV with UTF-8 encoding and try again.")
    except csv.Error:
        dialect = csv.excel
    try:
        reader = csv.reader(io.StringIO(text), dialect, strict=True)
        headers = [h.strip() for h in next(reader, [])]
        if not headers or any(not h or len(h) > 100 for h in headers):
            raise CatalogueProblem("The first row needs a heading for every column (up to 100 characters each).")
        if len(headers) > 50 or len(set(headers)) != len(headers):
            raise CatalogueProblem("Use up to 50 columns with unique headings.")
        rows = []
        for line, values in enumerate(reader, 2):
            if not any(v.strip() for v in values):
                continue
            if len(values) != len(headers):
                raise CatalogueProblem(f"Row {line} has {len(values)} columns; expected {len(headers)}.")
            if any(len(v) > 10000 for v in values):
                raise CatalogueProblem(f"Row {line} has a cell longer than 10,000 characters.")
            rows.append(dict(zip(headers, (v.strip() for v in values))))
            if len(rows) > MAX_ROWS:
                raise CatalogueProblem("Upload up to 20,000 items at a time.")
    except csv.Error:
        raise CatalogueProblem("The CSV has invalid quoting. Export it again and try uploading.")
    if not rows:
        raise CatalogueProblem("The CSV needs at least one item below the headings.")
    # Purge expired private staging data; only the latest preview per user is needed.
    CatalogueUpload.objects.filter(created_at__lt=timezone.now() - UPLOAD_TTL).delete()
    CatalogueUpload.objects.filter(owner=user).delete()
    return CatalogueUpload.objects.create(owner=user, filename=upload.name[:255], headers=headers, rows=rows)


def preview_data(upload):
    headers = upload.headers
    def guess(*names):
        return next((h for n in names for h in headers if h.casefold() == n), "")
    code = guess("plu_no", "plu", "code", "sku", "id", "item code")
    title = guess("title", "name", "item", "product", "description") or headers[0]
    description = guess("description", "details", "notes")
    if description == title:
        description = ""
    return {"upload_id": str(upload.pk), "headers": headers, "sample": upload.rows[:5],
            "count": len(upload.rows), "defaults": {"name": Path(upload.filename).stem[:100] or "My items", "title_column": title,
            "description_column": description, "code_column": code, "search_columns": headers}}


def get_upload(user, token):
    try:
        upload = CatalogueUpload.objects.filter(pk=token, owner=user,
            created_at__gte=timezone.now() - UPLOAD_TTL).first()
    except (ValueError, TypeError, ValidationError):
        upload = None
    if upload is None:
        raise CatalogueProblem("This preview has expired or isn't yours. Upload the CSV again.")
    return upload


def import_upload(user, token, mapping):
    upload = get_upload(user, token)
    headers = upload.headers
    title = mapping.get("title_column")
    description = mapping.get("description_column") or ""
    code = mapping.get("code_column") or ""
    selected = mapping.get("search_columns")
    target_id = mapping.get("catalogue_id")
    target_catalogue = select_catalogue(user, target_id) if target_id not in (None, "") else None
    name = mapping.get("name", target_catalogue.name if target_catalogue else Path(upload.filename).stem[:100] or "My items")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
        raise CatalogueProblem("Give your catalogue a name of up to 100 characters.")
    if title not in headers or (description and description not in headers) or (code and code not in headers):
        raise CatalogueProblem("Choose the title, description and code from your file's headings.")
    if not isinstance(selected, list) or not selected or any(h not in headers for h in selected):
        raise CatalogueProblem("Choose at least one searchable column from your file.")
    selected = list(dict.fromkeys(selected))
    prepared, skipped, codes, numbers = [], 0, set(), set()
    for row in upload.rows:
        if not row[title]:
            skipped += 1
            continue
        identifier = row[code] if code else ""
        if len(identifier) > 100:
            raise CatalogueProblem("Codes can have up to 100 characters. Choose another code column.")
        if identifier:
            if identifier in codes:
                raise CatalogueProblem(f"The code {identifier!r} appears more than once. Use unique codes or choose no code column.")
            codes.add(identifier)
        # Numeric PLU matching stays available for a catalogue mapped from plu_no.
        number = None
        if code.casefold() in ("plu_no", "plu") and identifier.isdigit():
            value = int(identifier)
            if value <= 2147483647:
                if value in numbers:
                    raise CatalogueProblem("Two PLU codes have the same numeric value. Remove the duplicate before importing.")
                numbers.add(value)
                number = value
        prepared.append(PluItem(title=row[title], description=row[description] if description else row[title],
            code=identifier, plu_no=number, fields=row,
            search_text="\n".join(row[h] for h in selected)))
    if not prepared:
        raise CatalogueProblem("No items have a value in the chosen title column. Choose another column.")
    with transaction.atomic():
        # Lock the user as well: first-time and concurrent imports serialize too.
        get_user_model().objects.select_for_update().get(pk=user.pk)
        get_upload(user, token)  # A concurrent request may have consumed this preview.
        target = mapping.get("catalogue_id")
        if target not in (None, ""):
            catalogue = select_catalogue(user, target)
        else:
            catalogue = Catalogue(owner=user)
        same_name = Catalogue.objects.filter(owner=user, name__iexact=name.strip())
        if catalogue.pk:
            same_name = same_name.exclude(pk=catalogue.pk)
        if same_name.exists():
            raise CatalogueProblem("You already have a catalogue with that name. Choose a different name, or select that catalogue to replace.")
        catalogue.name, catalogue.headers = name.strip(), headers
        catalogue.title_column, catalogue.description_column, catalogue.code_column = title, description, code
        catalogue.search_columns = selected
        catalogue.save()
        catalogue.items.all().delete()
        for item in prepared:
            item.catalogue = catalogue
        PluItem.objects.bulk_create(prepared, batch_size=500)
        upload.delete()
    return {"catalogue_id": catalogue.pk, "name": catalogue.name, "total": len(prepared), "skipped": skipped,
            "message": f"Saved {len(prepared)} private items in {catalogue.name}. Skipped {skipped} rows without a title."}
