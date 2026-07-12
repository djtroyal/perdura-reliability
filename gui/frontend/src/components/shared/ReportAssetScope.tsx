import { createContext, useContext } from 'react'

export interface ReportAssetScopeValue {
  module: string
  moduleLabel: string
}

const ReportAssetScope = createContext<ReportAssetScopeValue | null>(null)

export function ReportAssetScopeProvider({
  value, children,
}: {
  value: ReportAssetScopeValue
  children: React.ReactNode
}) {
  return <ReportAssetScope.Provider value={value}>{children}</ReportAssetScope.Provider>
}

export function useReportAssetScope() {
  return useContext(ReportAssetScope)
}
