import '../src/index.css'

const THEMES = ['dark', 'light', 'oled', 'paper']

/** @type { import('@storybook/react-vite').Preview } */
const preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: 'todo'
    },
    layout: 'padded',
  },
  initialGlobals: {
    theme: 'dark',
  },
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'App color theme',
      toolbar: {
        icon: 'paintbrush',
        items: THEMES.map(t => ({ value: t, title: t.charAt(0).toUpperCase() + t.slice(1) })),
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme || 'dark'
      document.documentElement.setAttribute('data-theme', theme)
      return (
        <div style={{
          fontFamily: 'var(--font-sans)',
          color: 'var(--text-app)',
          background: 'var(--bg-app)',
          padding: '16px',
          minHeight: '100px',
          borderRadius: '8px',
        }}>
          <Story />
        </div>
      )
    },
  ],
}

export default preview
