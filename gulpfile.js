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
    existsSync
} = require('node:fs');
const fs = require('node:fs/promises');

// Tools bundle/minify
const esbuild = require('esbuild');

// Gulp Plugins
const php2html = require('gulp-php2html');
const htmlmin = require('gulp-htmlmin');
const gulpif = require('gulp-if');
const plumber = require('gulp-plumber');

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
const defaultSourcePath = 'src';
const defaultBuildPath = 'dist';
const defaultAssetsPath = 'assets';

const PATHS = {
    SOURCE: CONFIG.path_source ?? defaultSourcePath,
    BUILD: CONFIG.path_build ?? defaultBuildPath,
    ASSETS: path.join(
        CONFIG.path_build ?? defaultBuildPath,
        CONFIG.dir_assets ?? defaultAssetsPath
    )
};

/* ------------------------------------------------ */

/**
 * Custom error for build errors
 * @extends Error
 */
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
            PATHS.ASSETS,
            crypto.randomUUID()
                .substring(0, 8) + '.min.js'
        );

        esbuild.buildSync({
            entryPoints: [sourcePath],
            bundle: true,
            minify: true,
            format: 'iife',
            outfile: buildPath,
        });

        return buildPath;
    } catch (err) {
        throw new BuildError(`Failed to build JS: "${sourcePath}"`, {
            cause: err
        });
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
            PATHS.ASSETS,
            crypto.randomUUID()
                .substring(0, 8) + '.min.css'
        );

        esbuild.buildSync({
            entryPoints: [sourcePath],
            bundle: true,
            minify: true,
            outfile: buildPath,
        });

        return buildPath;
    } catch (err) {
        throw new BuildError(`Failed to build CSS: "${sourcePath}"`, {
            cause: err
        });
    }
}

/** 
 * Build static file (that not modify the file)
 * 
 * @param {String} sourcePath
 * @return {String} buildPath
 */
function buildFile(sourcePath) {
    try {
        const fileExt = sourcePath
            .split('.')
            .at(-1);

        const buildPath = path.join(
            PATHS.ASSETS,
            crypto.randomUUID()
                .substring(0, 8) + '.' + fileExt
        );

        const input = createReadStream(sourcePath);
        const output = createWriteStream(buildPath);

        input.pipe(output);

        return buildPath;
    } catch (err) {
        throw new BuildError(`Failed to build File: "${sourcePath}"`, {
            cause: err
        });
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
                try {
                    if (!file.isBuffer())
                        throw new Error('Only buffer are supported');

                    const DIR_SOURCE_FILE = path.relative(
                        PATHS.SOURCE,
                        file.dirname
                    ); // Current file directory

                    const chunks = []; // Save html parts
                    
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
                        if (
                            source.startsWith('http://') ||
                            source.startsWith('https://') ||
                            source.startsWith('data:')
                        ) {
                            return source;
                        }
                        
                        const sourcePath = path.isAbsolute(source)
                            ? path.join(
                                PATHS.SOURCE,
                                source
                            )
                            : path.join(
                                PATHS.SOURCE,
                                DIR_SOURCE_FILE,
                                source
                            );

                        // Not try to build if file not found
                        if (!existsSync(sourcePath))
                            throw new BuildError(`File not found: "${sourcePath}"`);

                        /**
                         * @param {String} buildPath 
                         * @return {String}
                         */
                        const relativePath = function(buildPath) {
                            return path.join(
                                path.sep,
                                path.relative(
                                    PATHS.BUILD,
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
                            
                    const parser = new Parser({
                        onopentag(name, attributes) {
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
                                        buildFile
                                    );
                                }
                            } else if (
                                name === 'img' ||
                                name === 'source' ||
                                name === 'video' ||
                                name === 'audio'
                            ) {
                                // Images, videos, audios...
                                attributes.src = buildAsset(
                                    attributes.src,
                                    buildFile
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
                            chunks.push(escape(text));
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
                } catch (err) {
                    cb(err);
                }
            }
        }
    )
}

/* ------------------------------------------------ */

/** 
 * Clear dist content
 * @param {Function} cb
 * @return {void} 
 */
const ClearDist = async function(cb) {
    try {
        await fs.mkdir(PATHS.BUILD, {
            recursive: true
        });
        
        await del([
            PATHS.BUILD + '/**/*'
        ]);

        await fs.mkdir(PATHS.ASSETS, {
            recursive: true
        });

        await cb();
    } catch (err) {
        throw new BuildError(`Failed to clear dist: "${PATHS.BUILD}"`, {
            cause: err
        });
    }
}

/** 
 * Build html and his assets
 * @return {void} 
 */
const Builder = async function() {
    const isPHPFile = (file) => file.extname === '.php';

    return src([
        PATHS.SOURCE + '/**/*.html',
        PATHS.SOURCE + '/**/*.php'
    ])
        .pipe(plumber())
        .pipe(gulpif(isPHPFile, php2html()))
        .pipe(htmlmin({ 
            collapseWhitespace: true,
            removeComments: true,
            minifyCSS: true,
            minifyJS: true
        }))
        .pipe(buildall())
        .pipe(dest(PATHS.BUILD));
}

/* ------------------------------------------------ */

exports.default = series(
    ClearDist,
    Builder
);
