const path = require('path')
const CopyWebpackPlugin = require('copy-webpack-plugin')

const webpack = require('webpack');

module.exports = {
  entry: './web/index.ts',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'app.js'
  },
  plugins: [
    new webpack.ProvidePlugin({
      //process: 'process/browser.js',
      process: 'process/browser.js',
      Buffer: ['buffer', 'Buffer'],
    }),
    // Copy our app's index.html to the build folder.
    new CopyWebpackPlugin({
      patterns: [
        { from: './web/index.html', to: 'index.html' }
      ]
    })
  ],
  devtool: 'source-map',
  module: {
    rules: [

      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      }
    ]
  },
  resolve: {
    extensions: [ '.tsx', '.ts', '.js' ],
    /*fallback: {
      'https': require.resolve("https-browserify"),
      'http': require.resolve("stream-http"),
      "stream": require.resolve("stream-browserify"),
      "os": require.resolve("os-browserify/browser"),
      "crypto": require.resolve("crypto-browserify"),
      "util": require.resolve("util/"),
      "path": require.resolve("path-browserify"),
      "assert": require.resolve("assert/"),
      'buffer': require.resolve('buffer'),
      'process': require.resolve('process/browser.js')
    }*/
  },
  externals: [
    (function () {
      var IGNORES = [
        'electron'
        // 'fs'
      ]
      return function (context, request, callback) {
        if (IGNORES.indexOf(request) >= 0) {
          return callback(null, "require('" + request + "')")
        }
        return callback()
      }
    })()
  ]
}