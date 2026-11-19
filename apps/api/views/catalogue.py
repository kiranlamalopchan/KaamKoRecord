from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.plu import catalogue
from .. import serialize


class PrivateCatalogueView(APIView):
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response


class Search(PrivateCatalogueView):
    def get(self, request):
        q = (request.GET.get("q") or "").strip()[:500]
        chosen = catalogue.for_request(request)
        items = catalogue.selected_items(request)
        page, meta = serialize.page_of(request, catalogue.search_items(request.user, q, chosen.pk if chosen else None) if q else items.none(), catalogue.SEARCH_PAGE_SIZE)
        meta.update(q=q, results=[catalogue.item_data(i) for i in page], total=items.count(),
                    samples=[] if q else [catalogue.item_data(i) for i in items.order_by("pk")[:catalogue.SEARCH_PAGE_SIZE]],
                    catalogue=catalogue.configuration(chosen), catalogues=catalogue.catalogue_choices(request.user))
        return Response(meta)


def problem(error):
    return ValidationError({"detail": str(error)})


class Detail(PrivateCatalogueView):
    def get(self, request, pk):
        return Response(catalogue.item_data(get_object_or_404(catalogue.items_for(request.user), pk=pk)))

    def patch(self, request, pk):
        item = get_object_or_404(catalogue.items_for(request.user), pk=pk)
        try:
            item = catalogue.save_item(request.user, item.catalogue_id, request.data.get("fields"), item_id=item.pk)
        except catalogue.CatalogueProblem as error:
            raise problem(error)
        return Response(catalogue.item_data(item))

    def delete(self, request, pk):
        catalogue.delete_item(request.user, pk)
        return Response(status=204)


class Stock(PrivateCatalogueView):
    """{"change": 1} or {"change": -1} for a scan, {"count": 12} after counting."""
    def post(self, request, pk):
        try:
            item = catalogue.change_stock(request.user, pk, change=request.data.get("change"), count=request.data.get("count"))
        except catalogue.CatalogueProblem as error:
            raise problem(error)
        return Response(catalogue.item_data(item))


class Create(PrivateCatalogueView):
    def post(self, request):
        try:
            chosen = catalogue.create_catalogue(request.user, request.data)
        except catalogue.CatalogueProblem as error:
            raise problem(error)
        return Response({**catalogue.configuration(chosen), "count": 0}, status=201)


class Items(PrivateCatalogueView):
    """A catalogue's items as a table, a page at a time, and adding one."""
    def get(self, request, pk):
        chosen, items = catalogue.item_list(request.user, pk)
        page, meta = serialize.page_of(request, items, catalogue.LIST_PAGE_SIZE)
        meta.update(results=[catalogue.item_data(i) for i in page], catalogue=catalogue.configuration(chosen))
        return Response(meta)

    def post(self, request, pk):
        try:
            item = catalogue.save_item(request.user, pk, request.data.get("fields"))
        except catalogue.CatalogueProblem as error:
            raise problem(error)
        return Response(catalogue.item_data(item), status=201)


class Manage(PrivateCatalogueView):
    def get(self, request, pk):
        chosen = catalogue.select_catalogue(request.user, pk)
        return Response({**catalogue.configuration(chosen), "count": chosen.items.count()})

    def patch(self, request, pk):
        try:
            chosen = catalogue.update_catalogue(request.user, pk, request.data)
        except catalogue.CatalogueProblem as error:
            raise ValidationError({"detail": str(error)})
        return Response({**catalogue.configuration(chosen), "count": chosen.items.count()})

    def delete(self, request, pk):
        catalogue.delete_catalogue(request.user, pk)
        return Response(status=204)


class Preview(PrivateCatalogueView):
    def post(self, request):
        try:
            upload = catalogue.stage_upload(request.user, request.FILES.get("file"))
        except catalogue.CatalogueProblem as error:
            raise ValidationError({"detail": str(error)})
        return Response(catalogue.preview_data(upload))


class Import(PrivateCatalogueView):
    def post(self, request):
        try:
            result = catalogue.import_upload(request.user, request.data.get("upload_id"), request.data)
        except catalogue.CatalogueProblem as error:
            raise ValidationError({"detail": str(error)})
        return Response(result)
