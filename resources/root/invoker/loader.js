'use strict';

// This script will be invoked by `/app-*.*.*/resources/app/loader.js` (`../../indiv/loader.js`) with `require`.

const electron = require('electron');
const {app} = electron;

const fs = require('fs');
const Module = require('module');
const path = require('path');


console.info('::: loaded', __filename);

// dump versions
console.info('process.versions:', process.versions);

/*
// dump arguments
console.info('process.argv:', process.argv);

// dump environment variables
console.info('process.env:', process.env);
//*/


function writeJsonSync(file, data) {
    return fs.writeFileSync(file, JSON.stringify(data, null, '  '));
}


// load session data (from environment variable or file)
const tempDir = path.join(__dirname, '../temp');
const lastSessionJson = path.join(tempDir, 'lastsession.json');

let session;

if (process.env.__loaderConfig) {
    session = JSON.parse(process.env.__loaderConfig);
} else if (fs.existsSync(lastSessionJson)) {
    session = require(lastSessionJson);
    fs.unlinkSync(lastSessionJson);
} else {
    console.error(`Failed to load session file:\n  ${lastSessionJson}`);
    process.exit(-1);
}

const profile = session.profile;

if (profile) {
    process.on('exit', () => {
        writeJsonSync(lastSessionJson, session);
    });
}


function loader(packageJson) {
    if (!profile) {
        // TODO
        throw 'No profile specified';
    }

    // get path to app.asar
    const resDir = path.join(path.dirname(packageJson), '..');
    const appAsar = path.join(resDir, 'app.asar');
    const appAsarPackageJson = path.join(appAsar, 'package.json');

    // load package.json
    const pkg = require(appAsarPackageJson);

    // modify profile dir
    if (profile) {
        const appDataDir = path.join(session.profilesDir, profile);
        const userDataDir = path.join(appDataDir, pkg.name || 'app');
        const tempDir = path.join(session.tempDir, profile);

        app.setPath('appData', appDataDir);
        app.setPath('userData', userDataDir);
        app.setPath('temp', tempDir);

        // to allow multiple instances, change app name
        // TODO: restore it later?
        app.setName(`${app.getName()} (${profile})`);
    }

    // hack electron.app.getAppPath()
    app.setAppPath(appAsar);

    // register information
    require('./info.js').initialize({
        profile: profile,
        session: session,
    });

    // pre action
    require('./before.js');

    // load app
    Module._load(appAsar, module, true);

    // post action
    require('./after.js');
}

module.exports = loader;
