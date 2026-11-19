import { useState } from "react";
import { useRouter } from "expo-router";
import { catalogue, useCatalogueChanged } from "@/api/catalogue";
import { confirm } from "./confirm";
import { errorMessage } from "@/api/errors";

export function useDeleteCatalogue() {
  const router = useRouter(), changed = useCatalogueChanged();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const remove = (id: number, name: string, count: number) => {
    confirm(`Delete ${name}?`, `This permanently deletes this catalogue and its ${count.toLocaleString()} item${count === 1 ? "" : "s"}.`, "Delete", async () => {
      setBusyId(id); setError("");
      try {
        await catalogue.remove(id);
        router.replace({ pathname: "/plu", params: { view: "catalogues" } });
        changed();
      } catch (e: any) { setError(errorMessage(e)); }
      finally { setBusyId(null); }
    });
  };
  return { remove, busyId, error };
}
