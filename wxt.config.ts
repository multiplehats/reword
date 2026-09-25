import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'Reword — inline copy editor',
    description: 'Click any text on a live page, edit it in place, and copy one prompt your coding agent can apply.',
    permissions: ['storage', 'scripting', 'activeTab'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: 'Toggle copy editor (Alt+Shift+E)',
    },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+E' },
        description: 'Toggle the copy editor',
      },
    },
  },
});
