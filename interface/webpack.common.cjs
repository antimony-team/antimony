const path = require('path');
const webpack = require('webpack');
require('dotenv').config();

const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');

module.exports = {
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'build'),
    publicPath: '/',
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: 'public/index.html',
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'public',
          to: 'assets',
        },
      ],
    }),
    new MonacoWebpackPlugin({languages: ['yaml']}),
    new webpack.DefinePlugin({
      'process.env': JSON.stringify(process.env),
    }),
  ],
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/i,
        use: ['babel-loader', 'ifdef-loader'],
        exclude: /node_modules/,
      },
      {
        test: /\.(jpe?g|gif|png|svg|wav)$/i,
        loader: 'file-loader',
        options: {
          name: '[contenthash].[ext]',
        },
      },
    ],
  },
  optimization: {
    minimizer: [new CssMinimizerPlugin()],
  },
  resolve: {
    alias: {
      '@sb': path.resolve(__dirname, 'src/'),
    },
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
    fallback: {
      url: require.resolve('url/'),
    },
  },
};
