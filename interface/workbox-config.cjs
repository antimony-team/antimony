module.exports = {
    globDirectory: 'src/',
    globPatterns: [
        '**/*.{tsx,ts,sass}'
    ],
    swDest: 'src/sw.js',
    ignoreURLParametersMatching: [
        /^utm_/,
        /^fbclid$/
    ]
};