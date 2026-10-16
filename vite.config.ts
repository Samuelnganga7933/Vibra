import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react({
      // Story files export CSF objects, not React components. The React
      // plugin still injects a Fast Refresh accept hook into every .tsx,
      // which absorbs the HMR update without doing anything useful — so
      // edits to a `.stories.tsx` file silently no-op instead of bubbling
      // to a full iframe reload. Exclude them so changes propagate.
      exclude: [/\.stories\.tsx?$/],
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
