import {
  convertProjectUnits, getProjectState, UNIT_OPTIONS, useUnits,
} from '../../store/project'
import { sameGroup } from '../../store/units'
import { confirmDialog } from './useDialog'
import { toast } from './toast'

/** Project-wide unit selector, positioned beside the project name in App. */
export default function ProjectUnitsSelect() {
  const [units, setUnits] = useUnits()

  const handleChange = async (next: string) => {
    if (next === units) return
    const hasData = Object.keys(getProjectState().modules).length > 0
    if (sameGroup(units, next) && hasData &&
        await confirmDialog({
          title: `Convert existing values from ${units} to ${next}?`,
          body: 'Time-valued inputs (failure times, MTBF, mission time, rates, …) will be '
            + 'rescaled and computed results cleared for re-running. Choose Cancel to only '
            + 'change the label.',
          confirmLabel: 'Convert values',
        })) {
      convertProjectUnits(units, next)
      toast.success(`Converted values to ${next}.`)
    }
    setUnits(next)
  }

  return (
    <select
      value={units}
      onChange={event => void handleChange(event.target.value)}
      aria-label="Project units"
      title="Units for all data in this project. Switching between compatible units (e.g. hours/days) offers to convert existing values."
      className="flex-shrink-0 text-xs border border-gray-200 rounded px-1.5 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
    >
      {UNIT_OPTIONS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
    </select>
  )
}
