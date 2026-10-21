### Fixed

- **Labels on the violet buttons are readable.** The Save button, the editor's view-mode toggles,
  the welcome screen's action button, the diagram chat buttons and the activity-bar badge now draw
  their text and icons in near-black instead of white, which was very hard to read on the light
  violet. (#231)
- **Small grey labels are easier to read.** Labels such as "Selected text" in the prompt dialog,
  the front-matter header and values in the preview, empty-editor hints and the "Clean" git count
  use a lighter grey that meets the contrast minimum for text. (#231)
- **One clear focus outline everywhere.** The search bar, settings controls and dialog fields and
  dropdowns now show the same solid 2px outline as the rest of the app when you move to them with
  the keyboard, instead of a faint glow. Tabs, activity-bar buttons and toolbar buttons that had a
  1px outline now show the 2px one too. (#230)
- **A disabled "Delete" menu item no longer looks dangerous.** It is shown greyed out, like any
  other unavailable item, and no longer turns red under the pointer.
- **Consistent text sizes and square corners.** The activity-bar badge and the preview's
  front-matter labels use the app's text sizes, and the screenshot area-select hints have square
  corners like the rest of the app.
