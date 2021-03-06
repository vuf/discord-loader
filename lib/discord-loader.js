'use strict';

const Discord = require('./discord.js');
const posixpath = require('./posixpath.js');
const resource = require('./resource.js');
const {writeJsonSync} = require('./writejson.js');

const asar = require('asar-lite');
const fs = require('fs-extra');
const rimraf = require('rimraf');

const childProcess = require('child_process');
const path = require('path');


class DiscordLoader {
    /**
     * @param {string} discordDir - '/path/to/Discord/'
     */
    constructor(discordDir) {
        discordDir = path.normalize(discordDir);

        this.discordDir = discordDir;

        this.loaderDir = path.join(this.discordDir, 'loader');

        this.invokerDir = path.join(this.loaderDir, 'invoker');
        this.profilesDir = path.join(this.loaderDir, 'profiles');
        this.tempDir = path.join(this.loaderDir, 'temp');
        this.userDir = path.join(this.loaderDir, 'user');

        this.discord = new Discord(this.discordDir);

        this.rereadAppDirs();
    }


    /**
     * Search app directories ('/path/to/Discord/app-#.#.#/') again
     */
    rereadAppDirs() {
        this.appDirs = this.discord.searchAppDirs(true);
    }


    /**
     * Do install or update
     * @param {boolean} doModify - whether call `modify` to each app directories ('/path/to/Discord/app-#.#.#/') or not.
     */
    installOrUpdate(doModify = true) {
        if (fs.existsSync(this.loaderDir)) {
            this.update(doModify);
        } else {
            this.install(doModify);
        }
    }


    /**
     * Prepare files requried to launch discord-loader.
     * This is processed only when this is first launch of discord-loader.
     * @param {boolean} doModify - whether call `modify` to each app directories ('/path/to/Discord/app-#.#.#/') or not.
     */
    install(doModify = true) {
        resource.extractDirSync('root', this.loaderDir);

        fs.ensureDirSync(this.profilesDir);
        fs.ensureDirSync(this.tempDir);

        if (doModify) {
            this.modify();
        }
    }


    /**
     * Update core files.
     * This will be called every launch of discord-loader.
     * @param {boolean} doModify - whether call `modify` to each app directories ('/path/to/Discord/app-#.#.#/') or not.
     */
    update(doModify = true) {
        resource.extractDirSync('root/invoker', this.invokerDir);

        if (doModify) {
            this.modify();
        }
    }


    /**
     * Delete files requried to launch discord-loader.
     * @param {boolean} leaveUserFiles - whether leave 'loader/user/' directory or not.
     * @param {boolean} leaveProfiles - whether leave 'loader/profiles/' directory or not.
     * @param {boolean} doUnmodify - whether call `unmodify` to each app directories ('/path/to/Discord/app-#.#.#/') or not.
     */
    uninstall(leaveUserFiles = true, leaveProfiles = true, doUnmodify = true) {
        if (!leaveUserFiles && !leaveProfiles) {
            rimraf(this.loaderDir);
        } else {
            rimraf(this.invokerDir);
            rimraf(this.tempDir);
            if (!leaveUserFiles) rimraf(this.userDir);
            if (!leaveProfiles) rimraf(this.profilesDir);
        }

        if (doUnmodify) {
            this.unmodify();
        }
    }


    /**
     * Extract and modify package.json of the Discord App and make Discord App boot discord-loader.
     * This will be called every launch of discord-loader (to follow updates of the Discord App).
     * @param {string|null} appDir - '/path/to/Discord/app-#.#.#/'. Falsy values are treated as all app-#.#.# directories in this.discordDir.
     */
    modify(appDir = null) {
        if (!appDir) {
            this.appDirs.forEach(appDir => {
                if (!appDir) return;
                try {
                    this.modify(appDir);
                } catch (error) {
                    if (error instanceof DiscordLoader.Error.InvalidAppDir) {
                        return;
                    }
                    throw error;
                }
            });
            return;
        }

        if (!path.isAbsolute(appDir)) {
            appDir = path.join(this.discordDir, appDir);
        }

        const resDir = path.join(appDir, 'resources');
        const resAppDir = path.join(resDir, 'app');
        const resAppAsar = path.join(resDir, 'app.asar');
        const appPackageJson = path.join(resAppDir, 'package.json');
        const appLoaderJs = path.join(resAppDir, 'loader.js');

        if (!fs.existsSync(resAppAsar)) {
            throw new DiscordLoader.Error.InvalidAppDir();
        }

        const pkg = JSON.parse(asar.extractFile(resAppAsar, 'package.json'));
        pkg.main = posixpath(path.relative(path.dirname(appPackageJson), appLoaderJs));
        fs.ensureDirSync(resAppDir);
        writeJsonSync(appPackageJson, pkg);

        const pathToRootInvoker = posixpath(path.relative(path.dirname(appLoaderJs), this.invokerDir)) + '/';
        const pathToPackageJson = posixpath(path.relative(path.dirname(appLoaderJs), appPackageJson));

        let loaderScript = resource.readFileSync('loader-template.js');
        loaderScript = loaderScript.replace(/["']?<INVOKER>["']?/g, JSON.stringify(pathToRootInvoker));
        loaderScript = loaderScript.replace(/["']?<PACKAGE_JSON>["']?/g, JSON.stringify(pathToPackageJson));
        fs.writeFileSync(appLoaderJs, loaderScript);
    }


    /**
     * delete modified resources/app/ directory and disable discord-loader.
     * @param {string|null} appDir - '/path/to/Discord/app-#.#.#/'. Falsy values are treated as all app-#.#.# directories in this.discordDir.
     */
    unmodify(appDir = null) {
        if (!appDir) {
            this.appDirs.forEach(appDir => {
                if (!appDir) return;
                try {
                    this.unmodify(appDir);
                } catch (error) {
                    if (error instanceof DiscordLoader.Error.UnmodifiedAppDir) {
                        return;
                    }
                    throw error;
                }
            });
            return;
        }

        if (!path.isAbsolute(appDir)) {
            appDir = path.join(this.discordDir, appDir);
        }

        const resDir = path.join(appDir, 'resources');
        const resAppDir = path.join(resDir, 'app');

        if (!fs.existsSync(resAppDir)) {
            throw new DiscordLoader.Error.UnmodifiedAppDir();
        }

        rimraf(resAppDir);
    }


    /**
     * clear temporary directory (loader/temp).
     */
    clearTempDir() {
        rimraf(this.tempDir);
        fs.ensureDirSync(rimraf(this.tempDir));
    }


    /**
     * Launch discord-loader (through modified Discord App).
     * @param {string|null} profile - profile id
     * @param {boolean} debug - whether run in debug mode or not
     * @returns {ChildProcess} - launched process
     */
    launch(profile, debug = false) {
        if (!DiscordLoader.isValidProfile(profile, false)) {
            throw new DiscordLoader.Error.InvalidProfile();
        }

        const loaderConfig = {
            profile,
            debug,
            discordDir: this.discordDir,
            invokerDir: this.invokerDir,
            profilesDir: this.profilesDir,
            tempDir: this.tempDir,
            userDir: this.userDir,
        };

        let prog, args;
        switch (process.platform) {
            case 'win32':
                if (!debug) {
                    prog = path.join(this.discordDir, 'Update.exe');
                    args = ['-processStart', 'Discord.exe'];
                } else {
                    const rxAppSemver = /^app-(\d+)\.(\d+)\.(\d+)/;
                    const apps = this.appDirs.filter(dir => rxAppSemver.test(dir)).sort((a, b) => {
                        const matches = [a, b].map(dir => dir.match(rxAppSemver));
                        for (let i = 1; i <= 3; i++) {
                            const diff = parseInt(matches[1][i], 10) - parseInt(matches[0][i], 10);
                            if (diff) return diff;
                        }
                        return 0;
                    });

                    if (!apps.length) {
                        throw new DiscordLoader.Error.NoAppDirFound();
                    }

                    const latestApp = apps[0];

                    prog = path.join(this.discordDir, latestApp, 'Discord.exe');
                    args = [];
                }
                break;

            default:
                throw new DiscordLoader.Error.UnsupportedPlatform();
        }

        const proc = childProcess.spawn(prog, args, {
            env: {
                __loaderConfig: JSON.stringify(loaderConfig),
            },
        });

        return proc;
    }


    /**
     * Check if profile id is valid.
     * @param {string} profile - profile id
     * @param {boolean} checkExistence - whether check the profile actually exists or not
     * @returns {boolean} - true if valid
     */
    static isValidProfile(profile, checkExistence) {
        if (typeof profile !== 'string') {
            throw new DiscordLoader.Error.InvalidProfile();
        }

        if (!profile) return false;
        if (/^\.+$|\.$|[/\\]/.test(profile)) return false;
        if (checkExistence && !fs.existsSync(path.join(this.profilesDir, profile))) return false;

        return true;
    }
}

DiscordLoader.Error = {
    InvalidAppDir: class{},
    NoAppDirFound: class{},
    UnmodifiedAppDir: class{},
    UnsupportedPlatform: class{},
};


module.exports = DiscordLoader;
