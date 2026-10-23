import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'copy-static-dts-databases',
        closeBundle() {
          try {
            const outDataDir = path.resolve(__dirname, 'dist', 'data');
            fs.mkdirSync(outDataDir, { recursive: true });
            const dbFile = path.resolve(__dirname, '.dts-public-default-databases.json');
            if (fs.existsSync(dbFile)) {
              fs.copyFileSync(dbFile, path.join(outDataDir, 'public-default-databases.json'));
            }
            const profilesSrc = path.resolve(__dirname, '.cache', 'section_profiles_by_date');
            const profilesDest = path.join(outDataDir, 'section_profiles_by_date');
            if (fs.existsSync(profilesSrc)) {
              fs.mkdirSync(profilesDest, { recursive: true });
              const files = fs.readdirSync(profilesSrc);
              const allDates: string[] = [];
              for (const file of files) {
                if (file.endsWith('.json')) {
                  fs.copyFileSync(path.join(profilesSrc, file), path.join(profilesDest, file));
                  const m = file.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
                  if (m) allDates.push(m[1]);
                }
              }
              allDates.sort();
              fs.writeFileSync(path.join(profilesDest, 'all_dates.json'), JSON.stringify(allDates));
            }
          } catch (e) {
            console.warn('Could not copy static DTS databases to dist/data:', e);
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
