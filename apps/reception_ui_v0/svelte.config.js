import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // 検証はローカル(vite dev)。Cloud Run へ載せる際は adapter-node 等に差し替え（範囲外）。
    adapter: adapter()
  }
};

export default config;
