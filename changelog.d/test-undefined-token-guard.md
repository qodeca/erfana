### Internal

- **A test now catches a style that names a colour or spacing value that does not exist.** When a
  stylesheet names a design token that is not defined, the browser silently drops that style, so a
  border or background just disappears. The new check reads every app stylesheet, the inline styles
  in the code and the layering names handed to the overlay stack, and fails on any such name. It
  found none today. (#82)
