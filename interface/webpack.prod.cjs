const common = require('./webpack.common');

const {merge} = require('webpack-merge');

const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CompressionPlugin = require('compression-webpack-plugin');

module.exports = merge(common, {
  mode: 'production',
  plugins: [new MiniCssExtractPlugin(), new CompressionPlugin()],
  module: {
    rules: [
      {
        test: /\.(sa|sc|c)ss$/i,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
          'postcss-loader',
          'sass-loader',
        ],
      },
      {
        test: /\.(ts|tsx)$/i,
        use: [
          'babel-loader',
          {
            loader: 'ifdef-loader',
            options: {
              'ifdef-verbose': true,
              DEBUG: false,
            },
          },
        ],
        exclude: /node_modules/,
      },
    ],
  },
});
