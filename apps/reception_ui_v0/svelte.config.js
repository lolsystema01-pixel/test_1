import adapter from '@sveltejs/adapter-netlify';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // 検証本番=Netlify（明日からの現場利用向け・無料枠商用可）。正式移行時は adapter-node で Cloud Run へ。
    adapter: adapter()
  }
};

export default config;
