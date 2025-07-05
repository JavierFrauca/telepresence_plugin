# Guía Técnica: Anatomía de una Extensión de VS Code

## Introducción

Este documento explica los componentes principales que conforman una extensión de Visual Studio Code, utilizando como ejemplo la extensión Telepresence GUI. Esta guía está dirigida a desarrolladores que desean entender la estructura básica de una extensión y cómo los diferentes componentes interactúan entre sí.

## Componentes Principales

### 1. package.json - El Manifiesto de la Extensión

El archivo `package.json` es el corazón de cualquier extensión de VS Code. Define:

- **Metadatos de la extensión**: Nombre, descripción, versión, publicador, etc.
- **Punto de entrada**: Especifica el archivo principal que se ejecutará cuando la extensión se active.
- **Contribuciones**: Declara cómo la extensión extiende VS Code (comandos, vistas, configuraciones, etc.).
- **Activación**: Define cuándo se activa la extensión.
- **Dependencias**: Bibliotecas y paquetes que la extensión necesita.

En Telepresence GUI, el package.json:
```json
{
  "name": "telepresence-gui",
  "displayName": "Telepresence GUI",
  "description": "Graphical interface for managing Telepresence in Kubernetes",
  "version": "1.0.102",
  "publisher": "JavierFrauca",
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "viewsContainers": { ... },
    "views": { ... },
    "commands": [ ... ],
    ...
  }
}
```

### 2. extension.ts - Punto de Entrada

El archivo `extension.ts` (o `extension.js`) es el punto de entrada principal de la extensión. Contiene dos funciones clave:

- **activate()**: Se llama cuando la extensión se activa. Aquí se inicializan componentes y se registran comandos.
- **deactivate()**: Se llama cuando la extensión se desactiva, permitiendo limpieza.

En Telepresence GUI:
```typescript
export function activate(context: vscode.ExtensionContext) {
    // Inicializar componentes
    const telepresenceManager = new TelepresenceManager(context.workspaceState);
    const kubernetesManager = new KubernetesManager();
    // Registrar comandos, vistas, etc.
    context.subscriptions.push(
        vscode.commands.registerCommand('telepresence.openGui', () => { ... })
    );
}

export function deactivate() {
    // Limpiar recursos
}
```

### 3. Clases Gestoras - Lógica de Negocio

Archivos como `telepresenceManager.ts` y `kubernetesManager.ts` encapsulan la lógica de negocio específica:

- **TelepresenceManager**: Gestiona las operaciones relacionadas con Telepresence (conexiones, intercepciones).
- **KubernetesManager**: Maneja la interacción con clusters de Kubernetes y autenticación.

Estas clases abstraen la complejidad, permitiendo que el punto de entrada sea más limpio y mantenible.

### 4. Proveedores de UI - Interfaz de Usuario

Archivos como `webviewProvider.ts` y `treeProvider.ts` gestionan los elementos visuales:

- **WebviewProvider**: Crea y gestiona vistas HTML personalizadas dentro de VS Code.
- **TreeProvider**: Proporciona datos para las vistas de árbol en el panel lateral.

Estos componentes implementan interfaces específicas de VS Code como `TreeDataProvider` o `WebviewProvider` para integrarse con la UI del editor.

### 5. Localización (i18n)

El directorio `i18n` contiene:

- **Archivos de localización**: JSON con pares clave-valor para diferentes idiomas (en.json, es.json).
- **localizationManager.ts**: Gestiona la carga y uso de cadenas localizadas.

Este sistema permite que la extensión muestre texto en diferentes idiomas según la configuración del usuario.

### 6. Utilidades y Ayudantes

Archivos como `throttleUtility.ts` e `i18nAuditor.ts` proporcionan funcionalidades auxiliares:

- **ThrottleUtility**: Limita la frecuencia de llamadas a funciones para mejorar rendimiento.
- **I18nAuditor**: Verifica la completitud de las traducciones.

Estas utilidades no son específicas del dominio pero apoyan la funcionalidad principal.

## Flujo de Trabajo de una Extensión

1. **Activación**: VS Code carga la extensión según los `activationEvents` definidos en package.json.
2. **Inicialización**: Se ejecuta la función `activate()`, inicializando componentes y registrando comandos.
3. **Interacción del Usuario**: El usuario interactúa con los elementos de UI definidos en `contributes`.
4. **Ejecución de Comandos**: Se ejecutan los comandos registrados, que suelen delegar la lógica a los gestores.
5. **Desactivación**: Cuando VS Code se cierra o la extensión se desactiva, se ejecuta `deactivate()`.

## Ciclo de Compilación

1. **Desarrollo**: Edición de archivos TypeScript.
2. **Instalación de dependencias**: Ejecuta `npm install` para instalar las dependencias necesarias.
3. **Instalación de vsce**: Instala la herramienta de empaquetado de extensiones con `npm install -g @vscode/vsce` si no la tienes instalada globalmente.
4. **Compilación**: Transforma TypeScript a JavaScript mediante `npm run compile` (usa la configuración de `tsconfig.json`).
5. **Generación del paquete VSIX**: Ejecuta `vsce package` en la raíz del proyecto para crear el archivo `.vsix`.
6. **Publicación**: Sube el archivo `.vsix` al Marketplace de VS Code o distribúyelo de forma privada.

### Ejemplo de comandos

```sh
# Instalar dependencias
npm install

# Instalar vsce globalmente (si es necesario)
npm install -g @vscode/vsce

# Compilar el proyecto
npm run compile

# Generar el paquete VSIX
vsce package
```
