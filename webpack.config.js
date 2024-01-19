
// webpack.config.js
const path = require('path');
const nodeExternals = require('webpack-node-externals');
module.exports = {
  entry: './app.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  target: 'node', // Set the target to node
  externals: [nodeExternals()], // Exclude node_modules
  resolve: {
    fallback: {
      stream: require.resolve('stream-browserify'),
      https: false,
      http: require.resolve('stream-http'),
      path: require.resolve('path-browserify'),
    },
  },
};
