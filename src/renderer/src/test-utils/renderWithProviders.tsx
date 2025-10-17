import { ReactElement, PropsWithChildren } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { ToastProvider } from '../components/Toast/ToastContext'

function Providers({ children }: PropsWithChildren) {
  return <ToastProvider>{children}</ToastProvider>
}

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: Providers, ...options })
}

export * from '@testing-library/react'

