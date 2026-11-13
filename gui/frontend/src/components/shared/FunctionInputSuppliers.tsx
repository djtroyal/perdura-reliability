export interface FunctionInputSupplier {
  supplierLabel: string
  resourceName: string
  resourceId: string
}

export interface SystemFunctionTarget { instanceId: string; functionId: string }
export interface FunctionTraceNavigation {
  onNavigateFunction?: (target: SystemFunctionTarget) => void
  onNavigateInterface?: (interfaceId: string) => void
}

/** Compact read-only context for an authored input; no additional configuration. */
export default function FunctionInputSuppliers({ suppliers, id, inputNumber }: {
  suppliers: FunctionInputSupplier[]; id: string; inputNumber: number
}) {
  if (!suppliers.length) return null
  return <details className="mt-2 text-[11px] text-slate-600">
    <summary aria-label={`Input ${inputNumber} dependencies`} className="cursor-pointer rounded font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">Input dependencies</summary>
    <ul id={id} aria-label={`Suppliers for input ${inputNumber}`}
    className="mt-2 space-y-1 border-l-2 border-slate-200 pl-2 leading-relaxed">
    {suppliers.map(supplier => <li key={supplier.resourceId}>
      <span className="font-medium text-slate-700">{supplier.supplierLabel}</span>
      <span> · {supplier.resourceName}</span>
    </li>)}
    </ul>
  </details>
}
