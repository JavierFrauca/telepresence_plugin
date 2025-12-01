const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "..", "src", "i18n");
const destDir = path.join(__dirname, "..", "out", "i18n");

if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
}

fs.readdirSync(srcDir)
    .filter(file => file.endsWith(".json"))
    .forEach(file => {
        const src = path.join(srcDir, file);
        const dest = path.join(destDir, file);
        fs.copyFileSync(src, dest);
        console.log(`Copiado: ${file}`);
    });
