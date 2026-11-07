export default () => ({
  case_insensitive: true,
  contains: [
    {
      className: 'linenumber',
      begin: /^\d+(?=ඞ)/,
    },
    {
      className: 'linenumber-separator',
      begin: /ඞ/,
    },
  ],
});
