import { setProjectView, type ProjectView } from '../state'

/** Switch an unmounting project view and focus the equivalent tab in its replacement tree. */
export function switchProjectView(view: ProjectView): void {
  setProjectView(view)
}
