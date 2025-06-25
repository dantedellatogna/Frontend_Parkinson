const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let mainWindow;

// ✅ Utility: Correctly resolve Python script paths
function getPythonScriptPath(scriptName) {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'python', scriptName) // Packaged build
        : path.join(__dirname, 'python', scriptName);            // Development
}

function getPythonExecutable() {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'python', 'frontend-env', 'Scripts', 'python.exe')
        : path.join(__dirname, 'python', 'frontend-env', 'Scripts', 'python.exe');
}

app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: 1266,
        height: 950,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
        },
        autoHideMenuBar: true,
    });

    mainWindow.loadFile("index.html");
});

// ✅ File selection dialog
ipcMain.handle("select-file", async () => {
    const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "NIfTI Files", extensions: ["nii", "nii.gz"] }],
    });
    return result.filePaths;
});

// ✅ Inference handler
ipcMain.handle("run-inference", async (event, filePath) => {
    try {
        const scriptPath = getPythonScriptPath("backend.py");
        console.log("Resolved backend.py path:", scriptPath); // Debugging line
        
        const fs = require("fs");
        if (!fs.existsSync(scriptPath)) {
            console.error("Script not found:", scriptPath);
        } else {
            console.log("Script exists:", scriptPath);
        }

        const python = spawn(getPythonExecutable(), [scriptPath]);

        console.log("Running inference on:", filePath);

        const inputData = JSON.stringify({ file_path: filePath });
        let output = "";
        let errorOutput = "";

        python.stdout.on("data", (data) => {
            output += data.toString();
        });

        python.stderr.on("data", (data) => {
            errorOutput += data.toString();
        });

        return new Promise((resolve, reject) => {
            python.on("close", (code) => {
                console.log("Python process exited with code:", code);
                if (errorOutput) {
                    console.error("Python Error Output:", errorOutput);
                }

                try {
                    const jsonStart = output.indexOf("{");
                    const jsonEnd = output.lastIndexOf("}");
                    if (jsonStart !== -1 && jsonEnd !== -1) {
                        const jsonString = output.substring(jsonStart, jsonEnd + 1);
                        const result = JSON.parse(jsonString);
                        resolve(result);
                    } else {
                        throw new Error("Invalid JSON response");
                    }
                } catch (err) {
                    console.error("Error parsing JSON:", err);
                    reject({ error: "Invalid JSON response" });
                }
            });

            python.stdin.write(inputData + "\n");
            python.stdin.end();
        });
    } catch (err) {
        console.error("Error running inference:", err);
        return { error: "Failed to execute script" };
    }
});

// ✅ NIfTI slice extraction
ipcMain.handle("get-nifti-slices", async (event, filePath) => {
    const scriptPath = getPythonScriptPath("nifti2img.py");
    console.log("Script path (nifti2img):", scriptPath);

    const fs = require("fs"); 
    if (!fs.existsSync(scriptPath)) {
        console.error("Script not found:", scriptPath);
    } else {
        console.log("Script exists:", scriptPath);
    }

    return new Promise((resolve, reject) => {
        console.log("File to process:", filePath);

        const pythonProcess = spawn(getPythonExecutable(), [scriptPath, filePath]);

        let dataBuffer = "";

        pythonProcess.stdout.on("data", (data) => {
            dataBuffer += data.toString();
        });

        pythonProcess.stderr.on("data", (data) => {
            console.error(`Python error: ${data}`);
        });

        pythonProcess.on("close", (code) => {
            try {
                //console.log("Python raw output:", dataBuffer); // debugging line
                const result = JSON.parse(dataBuffer);
                if (result.error) {
                    reject(result.error);
                } else {
                    resolve(result.slices);
                }
            } catch (error) {
                reject("Failed to parse Python output");
            }
        });
    });
});
