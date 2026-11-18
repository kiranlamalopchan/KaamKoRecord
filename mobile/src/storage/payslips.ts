import type { PayslipCheck } from "@/api";
import { usePrivateState } from "./private";

export type SavedPayslip = { id: string; checkedAt: string; result: PayslipCheck };
const KEY = "payslip-history-v1";

export function usePayslipHistory() {
  const [rows, setRows, ready] = usePrivateState<SavedPayslip[]>(KEY, []);
  const save = (result: PayslipCheck) => setRows(previous => [{
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    checkedAt: new Date().toISOString(),
    result,
  }, ...previous].slice(0, 20));
  const remove = (id: string) => setRows(previous => previous.filter(row => row.id !== id));
  const clear = () => setRows([]);
  return { rows, ready, save, remove, clear };
}
