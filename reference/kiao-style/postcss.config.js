export default {
  plugins: {
    autoprefixer: {},
    cssnano: {
      preset: ['default', {
        discardComments: {
          removeAll: false,
        },
        normalizeWhitespace: true,
      }]
    }
  }
};
