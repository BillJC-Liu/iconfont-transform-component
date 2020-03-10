const chalk = require("chalk");
const fs = require("fs-extra");
const axios = require("axios");
const path = require("path");
const yargs = require("yargs");
const Agent = require("https").Agent;
const childProcess = require("child_process");
const htmlBoilerplatePath = path.resolve(__dirname, "./template/icon.html");
const lessBoilerplatePath = path.resolve(__dirname, "./template/iconfont.less");
const componentBoilerplatePath = path.resolve(__dirname, "./template/Icon.tsx");

function analyzeCSS(content, config) {
  // Process icon items
  // componentPath ： 组件的 path
  // cssPath ： icon的样式文件 path
  const { componentPath, cssPath, namespace } = config;
  const matchReg = new RegExp(`\\.${namespace}-(.*)\:before`, 'g')

  // 拿到className 数组   ["ics-arrow-right", "ics-arrow-left"] 
  const classList = content
    .match(matchReg)
    .map(_ => _.substr(1).replace(":before", ""));

  const componentContent = fs
    .readFileSync(componentBoilerplatePath) // 异步读取 Icon.tsx 文件
    .toString() // 将组件转为字符串
    .replace(  // 在 // {1} 的地方替换为其他  // {1} 的地方是Icon 枚举接口
      "// {1}",
      classList.map(_ => `${classNameToEnum(_, namespace)} = "${_}",`).join("\n")
    )
    // 在 {2} 处的地方 替换为 引入的iconfont.css 样式文件
    .replace("{2}", path.relative(path.join(componentPath, ".."), cssPath));

  // Process URLs (assets)·
  const assetURLs = content
    .match(/url\('(.|\n)*?'\)/g)
    .map(_ => _.substring(5, _.length - 2));

  let cssContent = fs
    .readFileSync(lessBoilerplatePath)
    .toString()
    .replace(
      `"{1}"`, // 在模板 less 样式文件中的字体文件地址替换成本地的
      assetURLs
        .map(url => transformToLocalURL(url, config))
        .filter(_ => _)
        .join(",")
    );
  const matchRegCss = new RegExp(`\\.${namespace}-(.|\\n)*?\\}`, "g")
  cssContent = cssContent.replace(`// {2}`, content.match(matchRegCss).join("\n"));
  // 修改 Icon.tsx 的模板文件
  fs.writeFileSync(componentPath, componentContent);
  // 修改 iconfont 的css 文件
  fs.writeFileSync(cssPath, cssContent);
  return classList;
}

function generatePreviewHtml(iconList, cssURL, config) {
  const { htmlPath, namespace } = config;
  const icons = iconList.map(_ =>
    `<div class="item"><i class="iconfont ${_}"></i><span>${classNameToEnum(_, namespace)}</span></div>`
  );
  fs.writeFileSync(
    htmlPath,
    fs
      .readFileSync(htmlBoilerplatePath)
      .toString()
      .replace("{1}", cssURL)
      .replace("{2}", icons.join(""))
      .replace("{3}", new Date().toLocaleString())
  );
}

function classNameToEnum(className, namespace) {
  const matchReg = new RegExp(`${namespace}\-[a-z\d]+(-[a-z\d]+)*`)
  // if (!((`/^${namespace}\-[a-z\d]+(-[a-z\d]+)*$/`).test(className))) {
  //   throw new Error(`${className} does not conform to naming convention`);
  // }

  if (!matchReg.test(className)) {
    throw new Error(`${className} does not conform to naming convention`);
  }

  return className
    .substring(5)
    .replace(/-/g, "_")
    .toUpperCase();
}

function transformToLocalURL(url, config) {
  const { cssPath, assetFolderPath } = config;
  if (url.startsWith("data:application/x-font-woff2;")) {
    return `url("${url}") format("woff")`;
  } else {
    const assetExtension = getExtension(url);
    const fontPath = path.relative(path.join(cssPath, ".."), assetFolderPath);
    if (assetExtension === "ttf") {
      downloadFontAsset(url, "iconfont.ttf", config);
      return `url("${fontPath}/iconfont.ttf") format("truetype")`;
    } else if (assetExtension === "woff") {
      downloadFontAsset(url, "iconfont.woff", config);
      return `url("${fontPath}/iconfont.woff") format("woff")`;
    } else if (assetExtension === "svg") {
      downloadFontAsset(url, "iconfont.svg", config);
      return `url("${fontPath}/iconfont.svg") format("svg")`;
    } else {
      return null;
    }
  }
}

function getExtension(url) {
  let extension = url.substr(url.lastIndexOf(".") + 1);
  const questionMarkIndex = extension.indexOf("?");
  if (questionMarkIndex > 0) extension = extension.substr(0, questionMarkIndex);
  return extension.toLowerCase();
}

async function downloadFontAsset(url, fileName, config) {
  const { assetFolderPath } = config;
  if (!fs.existsSync(assetFolderPath)) {
    fs.mkdirSync(assetFolderPath);
  }

  const path = assetFolderPath + "/" + fileName;
  if (url.startsWith("//")) url = "http:" + url;
  const response = await axios({ url, responseType: "stream" });
  response.data.pipe(fs.createWriteStream(path));
  return new Promise((resolve, reject) => {
    response.data.on("end", resolve);
    response.data.on("error", reject);
  });
}

async function getContent(url) {
  if (url.startsWith("//")) url = "http:" + url;
  const response = await axios.get(url, {
    httpsAgent: new Agent({ rejectUnauthorized: false })
  });
  return response.data;
}

function spawn(command, arguments) {
  const isWindows = process.platform === "win32";
  const result = childProcess.spawnSync(
    isWindows ? command + ".cmd" : command,
    arguments,
    {
      stdio: "inherit"
    }
  );
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      `non-zero exit code returned, code=${
      result.status
      }, command=${command} ${arguments.join(" ")}`
    );
    process.exit(1);
  }
}

async function generate(env) {
  console.log(chalk.red(`连接上了 ${new Date().getTime()}`));

  console.info(chalk`{white.bold usage:} 🎈 yarn icon \{icon-font-css-url\}`);
  const cssURL = yargs.argv._[0]; // 获取 node 命令后面的执行参数，也就是 阿里css 地址

  try {
    if (!cssURL) throw new Error("Missing CSS URL in command line");
    // TODO: check params if null
    const config = {
      https: env.https || false, // 是否使用的是 https 协议
      port: env.port || 3000, // 端口
      cssPath: env.iconCssPath, // 你要替换的 icon 样式文件 的位置
      assetFolderPath: env.iconFontFilePath, // 字体文件的位置
      componentPath: env.iconComponentPath, // 将最新的字体名字更新到组件
      htmlPath: env.iconHTMLPath, // 未知 
      namespace: env.namespace,
      prettierConfig:
        env.prettierConfig || path.resolve(__dirname, "../prettier.json") // 引入prettier 文件，代码格式化配置
    };

    // get 请求到该文件内容
    const cssContent = await getContent(cssURL);
    console.info(chalk`{white.bold 😍 CSS file content loaded}`);
    // 分析css 字符串内容
    const iconClassList = analyzeCSS(cssContent, config);
    console.info(
      chalk`{white.bold 😍 Generated ${iconClassList.length} icons}`
    );

    if (config.htmlPath) {
      // 查看 icon 的可视页面
      generatePreviewHtml(iconClassList, cssURL, config);
      console.info(chalk`{white.bold 😍 Generated HTML for preview}`);
    }

    spawn("prettier", [
      "--config",
      config.prettierConfig,
      "--write",
      config.cssPath
    ]);
    spawn("prettier", [
      "--config",
      config.prettierConfig,
      "--write",
      config.componentPath
    ]);
    console.info(chalk`{white.bold 💕 Format generated files}`);
    console.info(
      chalk`show on {green ${config.https ? "https" : "http"}://localhost:${
        config.port
        }/} \n`
    );
  } catch (e) {
    console.error(chalk`{red.bold ❌ Error: ${e.message}}`);
    process.exit(1);
  }
}

module.exports = generate;
