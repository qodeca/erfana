### Fixed

- **Enter in a confirm prompt now presses the button that has focus.** Before, Enter always confirmed,
  so tabbing to Cancel on a delete, discard or quit prompt and pressing Enter still deleted, discarded
  or quit. Those destructive prompts now open with focus on Cancel, other prompts open on Confirm, and
  holding Enter down no longer repeats into an answer.
