# Mermaid Diagram Test File

This file tests Mermaid diagram rendering in Erfana.

## Flowchart

```mermaid
graph TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Excellent!]
    B -->|No| D[Debug]
    D --> B
    C --> E[End]
```

## Sequence Diagram

```mermaid
sequenceDiagram
    participant User
    participant Erfana
    participant FileSystem
    User->>Erfana: Open markdown file
    Erfana->>FileSystem: Read file
    FileSystem-->>Erfana: File content
    Erfana->>Erfana: Render preview
    Erfana-->>User: Display rendered markdown
```

## Class Diagram

```mermaid
classDiagram
    class FileService {
        +readFile(path)
        +writeFile(path, content)
        +deleteFile(path)
        +rename(oldPath, newName)
    }
    class MarkdownEditorPanel {
        -currentFile
        -viewMode
        +loadFile()
        +handleSave()
    }
    MarkdownEditorPanel --> FileService
```

## State Diagram

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Loading: openFile
    Loading --> Editing: fileLoaded
    Editing --> Saving: Cmd+S
    Saving --> Editing: saved
    Editing --> [*]: closeFile
```

## Gantt Chart

```mermaid
gantt
    title Erfana Development Roadmap
    dateFormat  YYYY-MM-DD
    section Phase 1
    Mermaid Support    :done, 2024-10-12, 3d
    Git Integration    :active, 2024-10-15, 5d
    section Phase 2
    Terminal Panel     :2024-10-20, 7d
    Claude Integration :2024-10-27, 10d
```

## Invalid Syntax Test

This should show an error:

```mermaid
graph TD
    A --> B
    Missing closing brace {
```

## End of Test

If all diagrams except the last one render correctly, Mermaid integration is successful!
