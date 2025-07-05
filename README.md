# Telepresence Plugin for VS Code

This extension brings the power of Telepresence directly to Visual Studio Code, allowing developers to work with and debug Kubernetes microservices in a more agile and visual way. The goal is to simplify the remote development experience by integrating key tools into a single workflow within the editor.

## Main Features

- **Native Telepresence Integration**: Run, manage, and monitor Telepresence sessions without leaving VS Code, facilitating the development and debugging of services running in Kubernetes.
- **Simplified Kubernetes Cluster Login**: Authenticate and connect to clusters from multiple providers (Azure AKS, GKE, EKS, local, and generic) with an intuitive interface and minimal steps.
- **Advanced Authentication Support**: Integration with kubelogin for modern authentication in clusters requiring Azure AD, OIDC, and other identity methods.
- **Visual Management of Namespaces and Interceptions**: Visualize and manage connections to namespaces and traffic interceptions through an intuitive graphical interface and dedicated panels.
- **Dedicated Activity Bar**: Quickly access all functionalities from a side panel with specific views for namespace connections, active interceptions, and system status.
- **Interactive Control Panel**: Integrated web interface to manage all Telepresence functionalities with real-time information.
- **Detailed Notifications and Logs**: Receive relevant messages, warnings, and errors in real-time, with access to complete logs from the VS Code output panel.

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

## Contributions

Contributions are welcome. If you have ideas, find bugs, or want to propose improvements, please open an issue or pull request in the [GitHub repository](https://github.com/JavierFrauca/telepresence_plugin). Your feedback helps improve the extension for the entire community!

## License

This project is under the MIT license. See the LICENSE.txt file for more details.

---

Desarrollado con ❤️ para la comunidad de desarrolladores de Kubernetes y microservicios.