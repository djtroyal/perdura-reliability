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
    if (sameGroup(units, next) && hasData) {
      const confirmed = await confirmDialog({
          title: `Convert existing values from ${units} to ${next}?`,
          body: 'Affected calculation inputs will be converted and their results cleared for recalculation. '
            + 'LDA datasets keep their declared units, and Prediction settings remain in hours. Linked models convert at calculation time.',
          confirmLabel: 'Convert values',
        })
      if (!confirmed) return
      convertProjectUnits(units, next)
      toast.success(`Converted values to ${next}.`)
    } else if (hasData && units !== next && !await confirmDialog({ title: 'Change project quantity?',
      body: 'These units cannot be converted. Existing LDA datasets keep their declared quantity and unit. Review manual calculation inputs before recalculating.',
      confirmLabel: 'Change project default' })) return
    setUnits(next)
  }

  return (
    <select
      value={units}
      onChange={event => void handleChange(event.target.value)}
      aria-label="Project units"
      title="Default units for project calculations. Compatible changes offer to convert existing inputs; datasets retain their declared units."
      className="shrink-0 text-xs border border-gray-200 rounded px-1.5 py-1.5 text-gray-700 focus:outline-hidden focus:ring-1 focus:ring-blue-400"
    >
      {UNIT_OPTIONS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
    </select>
  )
}
