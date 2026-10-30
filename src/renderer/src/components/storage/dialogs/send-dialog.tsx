// Send a copy… (storage-links §3.5): any SQLite Store to a new, unlinked
// remote file; the Store's link does not change. The form is Publish's.
import { UploadDialog } from '@/components/storage/dialogs/publish-dialog'

export const SendDialog = (props: Omit<React.ComponentProps<typeof UploadDialog>, 'mode'>) => <UploadDialog {...props} mode="send" />
