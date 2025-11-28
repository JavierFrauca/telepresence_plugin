# Telepresence Plugin for VS Code

This extension brings the power of Telepresence directly to Visual Studio Code, allowing developers to work with and debug Kubernetes microservices in a more agile and visual way. The goal is to simplify the remote development experience by integrating key tools into a single workflow within the editor.

## Main Features

## Main Features

- **Auto-refresh configurable**: Automatically refresh status, deployments, and interceptions at a user-defined interval.
- **Manual refresh mode**: Set the auto-refresh interval to `0` to switch into manual mode and trigger status updates from the Activity Bar or the GUI refresh button when you need them.
- **Dedicated Activity Bar Panels**: Separate views for namespaces, interceptions, deployments, and system status.
- **Deployment Management**:
  - Scale deployments (change replica count) directly from the UI.
  - Restart deployments with a single action.
  - Deployments are now visualized separately from pods for easier management.
- **Enhanced Kubernetes Login Screen**: You can now delete saved cluster connections directly from the login interface.
- **New Commands**:
  - Connect only to a namespace (`telepresence.connectNamespace`)
  - Disconnect from a namespace (`telepresence.disconnectNamespace`)
  - Intercept traffic (`telepresence.interceptTraffic`)
  - Simple Kubernetes login via webview (`telepresence.loginToKubernetes`)
  - Guided installation for Telepresence, kubectl, and kubelogin
  - Refresh views (namespace, interceptions, status)
  - Internationalization audit (`I18nAuditor`)
- **Improved Visual Management**: More feedback and notifications for every action.
- **Automatic Prerequisite Checks**: On activation, the extension checks for required tools and offers installation options.
- **Expanded kubelogin Support**: Recommended for any Kubernetes cluster, not just Azure.

## Installation

1. Install the extension from VS Code Marketplace or download the `.vsix` file and use the "Install from VSIX" option in VS Code.
2. Make sure you have the following tools installed (the extension can help you install them):
   - [Telepresence](https://www.telepresence.io/docs/latest/install/)
   - [kubectl](https://kubernetes.io/docs/tasks/tools/)
   - [kubelogin](https://github.com/Azure/kubelogin) (recommended for clusters with authentication)

## Usage

### Kubernetes Login

1. Access the `Telepresence: Login to Kubernetes` command from the command palette or by clicking on the context status in the control panel.
2. Select your cluster provider (Azure AKS, GKE, EKS, Local/Minikube, or Generic).
3. Authenticate if necessary and select the cluster you want to connect to.
4. The context will be automatically configured to work with Telepresence.

### Namespace and Interception Management

- **Namespaces**: Connect to a specific namespace using the dedicated view in the Activity Bar or from the control panel.
- **Interceptions**: Configure and manage traffic interceptions to specific services, allowing local development while receiving real traffic from the cluster.

### Main Commands

- `Telepresence: Login to Kubernetes` - Opens the Kubernetes login panel to select a cluster.
- `Telepresence: Connect to Namespace` - Connects to a specific namespace.
- `Telepresence: Intercept Traffic` - Configures a traffic interception to a service.
- `Telepresence: Disconnect` - Disconnects an active interception.
- `Telepresence: Show Version Info` - Shows information about tool versions.

### Status Refresh Modes

- The `telepresence.autoRefreshInterval` setting defines how often the shared status service refreshes data. The default is 20 seconds.
- Set the interval to `0` to enter manual mode. In this mode, the Activity Bar status view and the GUI's "Refresh Status" button trigger refreshes on demand without background polling.
- Both the Activity Bar and the webview consume the same cached snapshot, so a single refresh updates every surface and avoids redundant Telepresence CLI invocations.

## Requirements

- **Visual Studio Code**: Version 1.74.0 or higher
- **Operating System**: Windows, macOS, or Linux
- **Command Line Tools**:
  - Telepresence v2.5.0 or higher
  - kubectl v1.23.0 or higher
  - kubelogin (recommended for modern authentication)

## Features by Provider

The extension supports different Kubernetes providers, with specific features for each one:

- **Azure AKS**: Integrated login with Azure CLI, cluster listing, automatic kubelogin configuration
- **Google GKE**: Authentication via gcloud, credential retrieval
- **Amazon EKS**: Integration with AWS CLI, credential configuration
- **Local/Minikube**: Automatic detection of local contexts
- **Generic**: Support for any other type of Kubernetes cluster

## Troubleshooting

If you encounter any issues with the extension:

1. Verify that the command-line tools (Telepresence, kubectl, kubelogin) are correctly installed and accessible in the PATH.
2. Check the extension logs in the "OUTPUT" section of VS Code, selecting "Telepresence" in the dropdown.
3. Use the `Telepresence: Show Version Info` command to verify the installed versions.

## Packaging & Distribution

1. Install the official VS Code packaging tool (only once):
  ```bash
  npm install -g @vscode/vsce
  ```
2. From the project root (`c:\repo\telepresence_plugin`), build a `.vsix` file:
  ```bash
  vsce package
  ```
  This runs `npm run vscode:prepublish` under the hood and emits `telepresence-gui-<version>.vsix` in the same folder.
3. Install the generated package locally via **Extensions → … → Install from VSIX…** or from the CLI:
  ```bash
  code --install-extension telepresence-gui-<version>.vsix
  ```
4. Optional helpers:
  - `vsce ls` shows which files will be included before packaging.
  - `vsce publish` uploads to the Marketplace (requires a publisher PAT).

## Contributions

Contributions are welcome. If you have ideas, find bugs, or want to propose improvements, please open an issue or pull request in the [GitHub repository](https://github.com/JavierFrauca/telepresence_plugin). Your feedback helps improve the extension for the entire community!

## License

This project is under the MIT license. See the LICENSE.txt file for more details.

---

Desarrollado con ❤️ para la comunidad de desarrolladores de Kubernetes y microservicios.