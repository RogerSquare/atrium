import ErrorToast from '../ErrorToast'

export default {
  title: 'Components/ErrorToast',
  component: ErrorToast,
  parameters: { layout: 'fullscreen' },
}

export const Default = {
  args: {
    message: 'Batch update failed (500)',
    onDismiss: () => {},
  },
}

export const NetworkError = {
  args: {
    message: 'Batch delete failed — network error',
    onDismiss: () => {},
  },
}

export const Hidden = {
  args: {
    message: null,
    onDismiss: () => {},
  },
}
