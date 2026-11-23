import type { MTATask, MTAPersonnelRole, MTAResource } from '../../api/client'
import type { ComponentPolicy } from '../../api/systemTools'
import { quantityConversionFactor, quantityFromProjectUnit } from './datasetUnits'

export interface SystemTaskCatalog { tasks: MTATask[]; personnel: MTAPersonnelRole[]; resources: MTAResource[] }
export function importSystemRepairTask(catalog: SystemTaskCatalog, id: string, units: string): { policy: Partial<ComponentPolicy>; capacity: number } {
  const task = catalog.tasks?.find(task => task.id === id)
  if (!task) throw new Error('The selected maintenance task no longer exists.')
  if (task.status === 'superseded' || task.task_type !== 'corrective') throw new Error('Select a current corrective maintenance task.')
  if (!task.takes_asset_out_of_service || task.affected_asset_count !== 1)
    throw new Error('System repair requires a task that takes exactly one affected asset out of service.')
  if (task.steps.length !== 1) throw new Error('Only a single-step task can be imported. Multi-step precedence and branching remain in Maintenance Task Analysis.')
  const step = task.steps[0]
  if (step.predecessor_step_ids.length || step.execution_probability !== 1 || step.branch_group)
    throw new Error('Conditional branches and step dependencies cannot be flattened into a repair duration.')
  if (step.resources.length) throw new Error('This task reserves tools, stock or other resources. Use Maintenance Task Analysis; those resource constraints cannot be dropped during import.')
  if (step.duration.mode !== 'fixed' || !(step.duration.fixed_hours > 0))
    throw new Error('Task import currently requires a positive fixed duration. PERT/triangular task uncertainty remains in Maintenance Task Analysis.')
  if (step.personnel.length !== 1 || step.personnel[0].engagement_fraction !== 1)
    throw new Error('Task import requires one fully engaged personnel role; multiple skills or partial engagement need the task scheduler.')
  const assignment = step.personnel[0], role = catalog.personnel?.find(role => role.id === assignment.role_id)
  if (!role) throw new Error('The task personnel role is missing from the catalog.')
  if (role.weekly_shifts?.length || role.planned_outages?.length)
    throw new Error('Shift calendars and planned personnel outages require the maintenance-task scheduler.')
  if (!Number.isInteger(assignment.headcount) || !Number.isInteger(role.available_headcount) || assignment.headcount < 1 || assignment.headcount > role.available_headcount || role.available_headcount > 64)
    throw new Error('Concurrent task demand must fit an integer personnel pool of 1–64 available people.')
  const factor = quantityConversionFactor({ kind: 'time', unit: 'hours' }, quantityFromProjectUnit(units))
  return { capacity: role.available_headcount, policy: {
    repair: { distribution: 'deterministic', params: { value: step.duration.fixed_hours * factor } },
    crew_demand: assignment.headcount, crew_role_id: role.id,
    task_source: { task_id: task.id, title: task.title, revision: task.revision, signature: JSON.stringify({ task, role }) },
  } }
}

export function systemTaskSourceIssue(catalog: SystemTaskCatalog, policies: Record<string, ComponentPolicy>, units: string, capacity?: number): string | null {
  for (const policy of Object.values(policies)) {
    if (!policy.task_source) continue
    try {
      const current = importSystemRepairTask(catalog, policy.task_source.task_id, units)
      if (capacity != null && capacity > current.capacity)
        return `The configured crew pool exceeds the available personnel for “${policy.task_source.title}”. Reduce the pool or revise and reimport the catalog role.`
      if (current.policy.task_source?.signature !== policy.task_source.signature)
        return `Maintenance task “${policy.task_source.title}” or its personnel changed. Reimport the task before simulating.`
    } catch (error) { return (error as Error).message }
  }
  return null
}
