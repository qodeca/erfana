/// <reference types="vite/client" />

// Type declaration for Vite's ?raw import suffix
// Allows importing files as raw strings at build time
declare module '*.md?raw' {
  const content: string
  export default content
}
