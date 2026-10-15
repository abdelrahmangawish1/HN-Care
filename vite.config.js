const path = require("node:path");

const apiProxy = {
  "/api": "http://localhost:3001",
};

module.exports = {
  root: path.resolve(__dirname, "Frontend"),
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
};
