/**
 * @file This is a HTML bundler
 * @author lou_du_poitou
 * @license MIT
 * @copyright V / Lou du Poitou 2026
 * 
 * http://loudupoitou.dns-dynamic.net
 * Made by V / Lou du Poitou
 */

const { 
    src,
    dest,
    series
} = require('gulp');

// To parse/modify HTML
const {
    Parser
} = require('htmlparser2');
const escape = require('escape-html');

// Node modules
const path = require('node:path');
const crypto = require('node:crypto');
const { 
    Transform
} = require('node:stream');
const { 
    createReadStream,
    createWriteStream,
} = require('node:fs');
const fs = require('node:fs/promises');

// Tools bundle/minify
const esbuild = require('esbuild');

// Gulp Plugins
const php2html = require('gulp-php2html');
const htmlmin = require('gulp-htmlmin');
const gulpif = require('gulp-if');

// Others
const del = require('delete');

/** 
 * Builder configuration
 * @property {String} path_source
 * @property {String} path_build
 * @property {String} dir_assets
 */
const CONFIG = require('./gulpfile.config.json');

// Paths input/output
const PATH_SOURCE = CONFIG.path_source ?? 'src';
const PATH_BUILD = CONFIG.path_build ?? 'dist';

const DIR_ASSETS = CONFIG.dir_assets ?? 'assets';

const PATH_ASSETS = path.join(
    PATH_BUILD,
    DIR_ASSETS
);

/* ------------------------------------------------ */

class BuildError extends Error {}

/* ------------------------------------------------ */

/** 
 * Bundle and minify JS file
 * 
 * @param {String} sourcePath
 * @return {String} buildPath
 */
function buildJS(sourcePath) {
    try {
        const buildPath = path.join(
            PATH_ASSETS,
            crypto.randomUUID()
                .substring(0, 8) + '.min.js'
        );

        esbuild.build({
            entryPoints: [sourcePath],
            bundle: true,
            minify: true,
            format: 'iife',
            outfile: buildPath,
        });

        return buildPath;
    } catch (err) {
        throw new BuildError(err);
    }
}

/** 
 * Bundle and minify CSS file
 * 
 * @param {String} sourcePath
 * @return {String} buildPath
 */
function buildCSS(sourcePath) {
    try {
        const buildPath = path.join(
            PATH_ASSETS,
            crypto.randomUUID()
                .substring(0, 8) + '.min.css'
        );
    
        esbuild.build({
            entryPoints: [sourcePath],
            bundle: true,
            minify: true,
            outfile: buildPath,
        });
    
        return buildPath;
    } catch (err) {
        throw new BuildError(err);
    }
}

/** 
 * Build image file (that not modify the image)
 * 
 * @param {String} sourcePath
 * @return {String} buildPath
 */
function buildImg(sourcePath) {
    try {
        const imgExt = sourcePath
            .split('.')
            .at(-1);
    
        const buildPath = path.join(
            PATH_ASSETS,
            crypto.randomUUID()
                .substring(0, 8) + '.' + imgExt
        );
    
        const input = createReadStream(sourcePath);
        const output = createWriteStream(buildPath);
    
        input.pipe(output);
    
        return buildPath;
    } catch (err) {
        throw new BuildError(err);
    }
}

/* ------------------------------------------------ */

/** 
 * Find, build all assets and replace
 * the HTML sources
 * 
 * @return {Transform} 
 */
function buildall() {
    // Save the built assets to avoid rebuilding them
    const builtAssets = new Map();

    return new Transform({
            objectMode: true,
            transform(file, _, cb) {
                if (!file.isBuffer())
                    throw new Error('only buffer are supported');

                const DIR_SOURCE_FILE = path.relative(
                    PATH_SOURCE,
                    file.dirname
                ); // Current file directory

                const chunks = []; // Save html parts
                const parser = new Parser({
                    onopentag(name, attributes) {
                        /**
                         * Build an asset and return the relative 
                         * path from the current file
                         * 
                         * @param {Object} attribute 
                         * @param {Function} builder 
                         * @returns {String}
                         */
                        const buildAsset = function(
                            source,
                            builder
                        ) {
                            if (source.startsWith('http')) {
                                return source;
                            }

                            const sourcePath = path.isAbsolute(source)
                                ? path.join(
                                    PATH_SOURCE,
                                    source
                                )
                                : path.join(
                                    PATH_SOURCE,
                                    DIR_SOURCE_FILE,
                                    source
                                );

                            /**
                             * @param {String} buildPath 
                             * @return {String}
                             */
                            const relativePath = function(buildPath) {
                                return path.join(
                                    path.sep,
                                    path.relative(
                                        PATH_BUILD,
                                        buildPath
                                    )
                                )
                                    .split(path.sep)
                                    .join('/');
                            };

                            // Check if the asset is not already built
                            const builtAsset = builtAssets.get(sourcePath);
                            if (builtAsset) {
                                return relativePath(builtAsset);
                            }

                            const buildPath = builder(sourcePath);
                            builtAssets.set(
                                sourcePath,
                                buildPath
                            ); // Save

                            return relativePath(buildPath);
                        };

                        // Find the assets (scripts, styles, images, icons...)
                        // And then build the assets (bundle, minify, copy...)
                        if (name === 'script') {
                            // Scripts
                            attributes.src = buildAsset(
                                attributes.src,
                                buildJS
                            );
                        } else if (name === 'link') {
                            if (attributes.rel === 'stylesheet') {
                                // Styles
                                attributes.href = buildAsset(
                                    attributes.href,
                                    buildCSS
                                );
                            } else if (attributes.rel.includes('icon')) {
                                // Icons
                                attributes.href = buildAsset(
                                    attributes.href,
                                    buildImg
                                );
                            }
                        } else if (name === 'img') {
                            // Images
                            attributes.src = buildAsset(
                                attributes.src,
                                buildImg
                            );
                        }

                        // Push the HTML element with updated attributes
                        const attributesHtml = Object.entries(attributes)
                            .map(([key, value]) => {
                                return `${key}="${escape(value)}"`;
                            })
                            .join(' ');

                        let elementHtml;
                        if (attributesHtml) {
                            elementHtml = `<${name} ${attributesHtml}>`
                        } else {
                            elementHtml = `<${name}>`
                        };

                        chunks.push(elementHtml);
                    },
                    ontext(text) {
                        // Push text
                        chunks.push(text);
                    },
                    onclosetag(name, isImplied) {
                        if (!isImplied) {
                            // Push close tags
                            chunks.push(`</${name}>`);
                        }
                    },
                    onprocessinginstruction(name, data) {
                        if (name === '!doctype') {
                            chunks.push(`<${data}>`);
                        }
                    }
                });
                
                const html = file.contents.toString('utf8');
                parser.write(html);
                parser.end();

                file.contents = Buffer.from(chunks.join(''));

                cb(null, file);
            }
        }
    )
}

/* ------------------------------------------------ */

/** @return {void} */
const ClearDist = async function(cb) {
    try {
        await fs.mkdir(PATH_BUILD);
    } catch {}

    try {
        await del([
            PATH_BUILD + '/**/*'
        ]);

        await fs.mkdir(PATH_ASSETS);
    } finally {
        await cb();
    }
}

/** @return {void} */
const Builder = async function() {
    const isPHPFile = (file) => file.extname === '.php';

    return src([
        PATH_SOURCE + '/**/*.html',
        PATH_SOURCE + '/**/*.php'
    ])
        .pipe(gulpif(isPHPFile, php2html()))
        .pipe(htmlmin({ 
            collapseWhitespace: true,
            removeComments: true
        }))
        .pipe(buildall())
        .pipe(dest(PATH_BUILD));
}

/* ------------------------------------------------ */

exports.default = series(
    ClearDist,
    Builder
);
