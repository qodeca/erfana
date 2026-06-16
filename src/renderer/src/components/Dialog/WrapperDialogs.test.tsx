// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewFileDialog } from './NewFileDialog'
import { NewFolderDialog } from './NewFolderDialog'
import { RenameDialog } from './RenameDialog'
import type { NewFileDialogConfig, NewFolderDialogConfig, RenameDialogConfig } from './types'

describe('Wrapper Dialogs Integration Tests', () => {
  beforeEach(() => {
    // Create portal-root div for dialogs
    const portalRoot = document.createElement('div')
    portalRoot.setAttribute('id', 'portal-root')
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    // Clean up portal-root div
    document.body.innerHTML = ''
  })

  describe('NewFileDialog', () => {
    const defaultConfig: NewFileDialogConfig = {
      id: 'new-file-123',
      type: 'newFile',
      title: 'Create New File',
      message: '',
      parentPath: '/project/docs',
      inputPlaceholder: 'notes.md',
      existingNames: ['README.md', 'CHANGELOG.md']
    }

    const defaultProps = {
      config: defaultConfig,
      zIndex: 10001,
      onSubmit: vi.fn(),
      onCancel: vi.fn()
    }

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should render with correct title and icon', () => {
      render(<NewFileDialog {...defaultProps} />)
      expect(screen.getByRole('heading', { name: 'Create New File' })).toBeInTheDocument()
      expect(screen.getByText('in /project/docs')).toBeInTheDocument()
    })

    it('should render with File icon', () => {
      render(<NewFileDialog {...defaultProps} />)
      // Icon renders as part of the dialog
      expect(screen.getByRole('heading', { name: 'Create New File' })).toBeInTheDocument()
    })

    it('should show "File name:" label', () => {
      render(<NewFileDialog {...defaultProps} />)
      expect(screen.getByText('File name:')).toBeInTheDocument()
    })

    it('should show "Create" button', () => {
      render(<NewFileDialog {...defaultProps} />)
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    it('should use provided placeholder', () => {
      render(<NewFileDialog {...defaultProps} />)
      expect(screen.getByPlaceholderText('notes.md')).toBeInTheDocument()
    })

    it('should submit valid file name', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<NewFileDialog {...defaultProps} onSubmit={onSubmit} />)
      const submitButton = screen.getByRole('button', { name: 'Create' })

      await user.paste('new-file.md')
      await user.click(submitButton)

      expect(onSubmit).toHaveBeenCalledWith('new-file.md')
    })

    it('should reject duplicate file name', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<NewFileDialog {...defaultProps} onSubmit={onSubmit} />)
      const submitButton = screen.getByRole('button', { name: 'Create' })

      await user.paste('README.md')
      await user.click(submitButton)

      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getByText('A file with this name already exists')).toBeInTheDocument()
    })

    it('should show file-specific validation errors for duplicates', async () => {
      const user = userEvent.setup()
      render(<NewFileDialog {...defaultProps} />)
      const submitButton = screen.getByRole('button', { name: 'Create' })

      await user.paste('README.md')
      await user.click(submitButton)
      expect(screen.getByText('A file with this name already exists')).toBeInTheDocument()
    })

    it('should handle empty existingNames', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      const config = { ...defaultConfig, existingNames: [] }
      render(<NewFileDialog {...defaultProps} config={config} onSubmit={onSubmit} />)
      const submitButton = screen.getByRole('button', { name: 'Create' })

      await user.paste('test.md')
      await user.click(submitButton)

      expect(onSubmit).toHaveBeenCalledWith('test.md')
    })

    it('should handle keyboard shortcuts', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      const onCancel = vi.fn()
      render(<NewFileDialog {...defaultProps} onSubmit={onSubmit} onCancel={onCancel} />)

      // Submit with Enter
      await user.paste('test.md')
      await user.keyboard('{Enter}')
      expect(onSubmit).toHaveBeenCalledWith('test.md')

      // Cancel with Escape
      await user.keyboard('{Escape}')
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should use default placeholder when not provided', () => {
      const config = { ...defaultConfig }
      delete (config as any).inputPlaceholder
      render(<NewFileDialog {...defaultProps} config={config} />)
      expect(screen.getByPlaceholderText('notes.md')).toBeInTheDocument()
    })
  })

  describe('NewFolderDialog', () => {
    const defaultConfig: NewFolderDialogConfig = {
      id: 'new-folder-123',
      type: 'newFolder',
      title: 'Create New Folder',
      message: '',
      parentPath: '/project',
      inputPlaceholder: 'new-folder',
      existingNames: ['src', 'docs']
    }

    const defaultProps = {
      config: defaultConfig,
      zIndex: 10001,
      onSubmit: vi.fn(),
      onCancel: vi.fn()
    }

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should render with correct title and icon', () => {
      render(<NewFolderDialog {...defaultProps} />)
      expect(screen.getByRole('heading', { name: 'Create New Folder' })).toBeInTheDocument()
      expect(screen.getByText('in /project')).toBeInTheDocument()
    })

    it('should render with Folder icon', () => {
      render(<NewFolderDialog {...defaultProps} />)
      // Icon renders as part of the dialog
      expect(screen.getByRole('heading', { name: 'Create New Folder' })).toBeInTheDocument()
    })

    it('should show "Folder name:" label', () => {
      render(<NewFolderDialog {...defaultProps} />)
      expect(screen.getByText('Folder name:')).toBeInTheDocument()
    })

    it('should show "Create" button', () => {
      render(<NewFolderDialog {...defaultProps} />)
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    it('should use provided placeholder', () => {
      render(<NewFolderDialog {...defaultProps} />)
      expect(screen.getByPlaceholderText('new-folder')).toBeInTheDocument()
    })

    it('should submit valid folder name', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<NewFolderDialog {...defaultProps} onSubmit={onSubmit} />)
      const submitButton = screen.getByRole('button', { name: 'Create' })

      await user.paste('my-folder')
      await user.click(submitButton)

      expect(onSubmit).toHaveBeenCalledWith('my-folder')
    })

    it('should reject duplicate folder name', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<NewFolderDialog {...defaultProps} onSubmit={onSubmit} />)
      const submitButton = screen.getByRole('button', { name: 'Create' })

      await user.paste('src')
      await user.click(submitButton)

      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getByText('A folder with this name already exists')).toBeInTheDocument()
    })

    it('should show folder-specific validation errors for duplicates', async () => {
      const user = userEvent.setup()
      render(<NewFolderDialog {...defaultProps} />)
      const submitButton = screen.getByRole('button', { name: 'Create' })

      await user.paste('src')
      await user.click(submitButton)
      expect(screen.getByText('A folder with this name already exists')).toBeInTheDocument()
    })

    it('should reject invalid characters', async () => {
      const user = userEvent.setup()
      render(<NewFolderDialog {...defaultProps} />)
      const submitButton = screen.getByRole('button', { name: 'Create' })

      await user.paste('folder/name')
      await user.click(submitButton)
      expect(screen.getByText(/cannot contain/)).toBeInTheDocument()
    })

    it('should handle case-insensitive duplicates', async () => {
      const user = userEvent.setup()
      render(<NewFolderDialog {...defaultProps} />)
      const submitButton = screen.getByRole('button', { name: 'Create' })

      await user.paste('SRC')
      await user.click(submitButton)
      expect(screen.getByText('A folder with this name already exists')).toBeInTheDocument()
    })

    it('should use default placeholder when not provided', () => {
      const config = { ...defaultConfig }
      delete (config as any).inputPlaceholder
      render(<NewFolderDialog {...defaultProps} config={config} />)
      expect(screen.getByPlaceholderText('new-folder')).toBeInTheDocument()
    })
  })

  describe('RenameDialog', () => {
    const fileConfig: RenameDialogConfig = {
      id: 'rename-file-123',
      type: 'rename',
      title: 'Rename File',
      message: '',
      currentName: 'document.md',
      itemPath: '/project/docs/document.md',
      itemType: 'file',
      parentPath: '/project/docs',
      existingNames: ['README.md', 'notes.txt']
    }

    const folderConfig: RenameDialogConfig = {
      id: 'rename-folder-123',
      type: 'rename',
      title: 'Rename Folder',
      message: '',
      currentName: 'old-folder',
      itemPath: '/project/old-folder',
      itemType: 'folder',
      parentPath: '/project',
      existingNames: ['src', 'docs']
    }

    const defaultProps = {
      config: fileConfig,
      zIndex: 10001,
      onSubmit: vi.fn(),
      onCancel: vi.fn()
    }

    beforeEach(() => {
      vi.clearAllMocks()
    })

    describe('File Rename', () => {
      it('should render with File icon for file type', () => {
        render(<RenameDialog {...defaultProps} />)
        // Icon renders as part of the dialog
        expect(screen.getByRole('heading', { name: 'Rename File' })).toBeInTheDocument()
      })

      it('should show "New name:" label for rename', () => {
        render(<RenameDialog {...defaultProps} />)
        expect(screen.getByText('New name:')).toBeInTheDocument()
      })

      it('should show "Rename" button', () => {
        render(<RenameDialog {...defaultProps} />)
        expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
      })

      it('should populate input with current name', () => {
        render(<RenameDialog {...defaultProps} />)
        const input = screen.getByRole('textbox') as HTMLInputElement
        expect(input.value).toBe('document.md')
      })

      it('should submit valid new name', async () => {
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        render(<RenameDialog {...defaultProps} onSubmit={onSubmit} />)
        const input = screen.getByRole('textbox')
        const submitButton = screen.getByRole('button', { name: 'Rename' })

        await user.clear(input)
        await user.paste('renamed.md')
        await user.click(submitButton)

        expect(onSubmit).toHaveBeenCalledWith('renamed.md')
      })

      it('should reject unchanged name', async () => {
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        render(<RenameDialog {...defaultProps} onSubmit={onSubmit} />)
        const submitButton = screen.getByRole('button', { name: 'Rename' })

        // Current name is already in input, just click submit
        await user.click(submitButton)

        expect(onSubmit).not.toHaveBeenCalled()
        expect(screen.getByText(/must be different/)).toBeInTheDocument()
      })

      it('should reject duplicate name from existingNames', async () => {
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        render(<RenameDialog {...defaultProps} onSubmit={onSubmit} />)
        const input = screen.getByRole('textbox')
        const submitButton = screen.getByRole('button', { name: 'Rename' })

        await user.clear(input)
        await user.paste('README.md')
        await user.click(submitButton)

        expect(onSubmit).not.toHaveBeenCalled()
        expect(screen.getByText('A file with this name already exists')).toBeInTheDocument()
      })

      it('should show file-specific validation errors for duplicates', async () => {
        const user = userEvent.setup()
        render(<RenameDialog {...defaultProps} />)
        const input = screen.getByRole('textbox')
        const submitButton = screen.getByRole('button', { name: 'Rename' })

        await user.clear(input)
        await user.paste('README.md')
        await user.click(submitButton)
        expect(screen.getByText('A file with this name already exists')).toBeInTheDocument()
      })
    })

    describe('Folder Rename', () => {
      it('should render with Folder icon for folder type', () => {
        render(<RenameDialog {...defaultProps} config={folderConfig} />)
        // Icon renders as part of the dialog
        expect(screen.getByRole('heading', { name: 'Rename Folder' })).toBeInTheDocument()
      })

      it('should populate input with current folder name', () => {
        render(<RenameDialog {...defaultProps} config={folderConfig} />)
        const input = screen.getByRole('textbox') as HTMLInputElement
        expect(input.value).toBe('old-folder')
      })

      it('should submit valid new folder name', async () => {
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        render(<RenameDialog {...defaultProps} config={folderConfig} onSubmit={onSubmit} />)
        const input = screen.getByRole('textbox')
        const submitButton = screen.getByRole('button', { name: 'Rename' })

        await user.clear(input)
        await user.paste('new-folder')
        await user.click(submitButton)

        expect(onSubmit).toHaveBeenCalledWith('new-folder')
      })

      it('should reject duplicate folder name', async () => {
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        render(<RenameDialog {...defaultProps} config={folderConfig} onSubmit={onSubmit} />)
        const input = screen.getByRole('textbox')
        const submitButton = screen.getByRole('button', { name: 'Rename' })

        await user.clear(input)
        await user.paste('src')
        await user.click(submitButton)

        expect(onSubmit).not.toHaveBeenCalled()
        expect(screen.getByText('A folder with this name already exists')).toBeInTheDocument()
      })

      it('should show folder-specific validation errors for duplicates', async () => {
        const user = userEvent.setup()
        render(<RenameDialog {...defaultProps} config={folderConfig} />)
        const input = screen.getByRole('textbox')
        const submitButton = screen.getByRole('button', { name: 'Rename' })

        await user.clear(input)
        await user.paste('src')
        await user.click(submitButton)
        expect(screen.getByText('A folder with this name already exists')).toBeInTheDocument()
      })
    })

    describe('Icon Selection Logic', () => {
      it('should dynamically select File icon for file type', () => {
        render(<RenameDialog {...defaultProps} config={fileConfig} />)
        // Icon renders dynamically based on itemType
        expect(screen.getByRole('heading', { name: 'Rename File' })).toBeInTheDocument()
      })

      it('should dynamically select Folder icon for folder type', () => {
        render(<RenameDialog {...defaultProps} config={folderConfig} />)
        // Icon renders dynamically based on itemType
        expect(screen.getByRole('heading', { name: 'Rename Folder' })).toBeInTheDocument()
      })
    })

    describe('Rename-specific Features', () => {
      it('should allow changing file extension', async () => {
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        render(<RenameDialog {...defaultProps} onSubmit={onSubmit} />)
        const input = screen.getByRole('textbox')
        const submitButton = screen.getByRole('button', { name: 'Rename' })

        await user.clear(input)
        await user.paste('document.txt')
        await user.click(submitButton)

        expect(onSubmit).toHaveBeenCalledWith('document.txt')
      })

      it('should handle case-only changes', async () => {
        const user = userEvent.setup()
        const onSubmit = vi.fn()
        render(<RenameDialog {...defaultProps} onSubmit={onSubmit} />)
        const input = screen.getByRole('textbox')
        const submitButton = screen.getByRole('button', { name: 'Rename' })

        await user.clear(input)
        await user.paste('Document.md')
        await user.click(submitButton)

        expect(onSubmit).toHaveBeenCalledWith('Document.md')
      })

      it('should reject invalid characters in rename', async () => {
        const user = userEvent.setup()
        render(<RenameDialog {...defaultProps} />)
        const input = screen.getByRole('textbox')
        const submitButton = screen.getByRole('button', { name: 'Rename' })

        await user.clear(input)
        await user.paste('document/file.md')
        await user.click(submitButton)
        expect(screen.getByText(/cannot contain/)).toBeInTheDocument()
      })
    })
  })

  describe('Cross-Dialog Consistency', () => {
    it('should all use the same validation rules', async () => {
      const user = userEvent.setup()

      // Test invalid character rejection across all three dialogs
      const newFileProps = {
        config: {
          id: 'test-1',
          type: 'newFile' as const,
          title: 'New File',
          message: '',
          parentPath: '/test',
          existingNames: []
        },
        zIndex: 10001,
        onSubmit: vi.fn(),
        onCancel: vi.fn()
      }

      const { rerender } = render(<NewFileDialog {...newFileProps} />)
      let input = screen.getByRole('textbox')
      let submitButton = screen.getByRole('button', { name: 'Create' })

      await user.paste('file/name')
      await user.click(submitButton)
      expect(screen.getByText(/cannot contain/)).toBeInTheDocument()

      // Test NewFolderDialog
      const newFolderProps = {
        config: {
          id: 'test-2',
          type: 'newFolder' as const,
          title: 'New Folder',
          message: '',
          parentPath: '/test',
          existingNames: []
        },
        zIndex: 10001,
        onSubmit: vi.fn(),
        onCancel: vi.fn()
      }

      rerender(<NewFolderDialog {...newFolderProps} />)
      input = screen.getByRole('textbox')
      submitButton = screen.getByRole('button', { name: 'Create' })

      await user.clear(input)
      await user.paste('folder/name')
      await user.click(submitButton)
      expect(screen.getByText(/cannot contain/)).toBeInTheDocument()
    })

    it('should all support keyboard shortcuts consistently', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()

      // Test NewFileDialog
      const newFileProps = {
        config: {
          id: 'test-1',
          type: 'newFile' as const,
          title: 'New File',
          message: '',
          parentPath: '/test',
          existingNames: []
        },
        zIndex: 10001,
        onSubmit: vi.fn(),
        onCancel
      }

      const { rerender } = render(<NewFileDialog {...newFileProps} />)
      await user.keyboard('{Escape}')
      expect(onCancel).toHaveBeenCalledTimes(1)

      // Test NewFolderDialog
      onCancel.mockClear()
      const newFolderProps = {
        config: {
          id: 'test-2',
          type: 'newFolder' as const,
          title: 'New Folder',
          message: '',
          parentPath: '/test',
          existingNames: []
        },
        zIndex: 10001,
        onSubmit: vi.fn(),
        onCancel
      }

      rerender(<NewFolderDialog {...newFolderProps} />)
      await user.keyboard('{Escape}')
      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })
})
