import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import ErrorToast from './components/ErrorToast.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { SetupProvider } from './context/SetupContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SetupProvider>
        <AuthProvider>
          <App />
          <ErrorToast />
        </AuthProvider>
      </SetupProvider>
    </BrowserRouter>
  </StrictMode>,
)
