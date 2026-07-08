import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // LINE実機確認用トンネル（cloudflared）経由のアクセスを許可
  preview: { allowedHosts: ['.trycloudflare.com'] }
});
