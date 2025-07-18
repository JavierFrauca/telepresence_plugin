# Telepresence Plugin para VS Code

Esta extensión integra la potencia de Telepresence directamente en Visual Studio Code, permitiendo a los desarrolladores trabajar y depurar microservicios en Kubernetes de forma más ágil y visual. El objetivo es simplificar la experiencia de desarrollo remoto integrando herramientas clave en un único flujo de trabajo dentro del editor.

## Características Principales

## Características Principales

- **Auto-refresh configurable**: Actualización automática de estado, deployments e intercepciones según el intervalo definido en la configuración.
- **Paneles dedicados en la barra de actividades**: Vistas separadas para espacios de nombres, intercepciones, deployments y estado del sistema.
- **Gestión de deployments**:
  - Escalado de deployments (cambiar el número de réplicas) directamente desde la interfaz.
  - Reinicio de deployments con un solo clic.
  - Los deployments se visualizan ahora separados de los pods para una gestión más sencilla.
- **Pantalla de login Kubernetes mejorada**: Ahora puedes eliminar conexiones guardadas directamente desde la interfaz de login.
- **Nuevos comandos**:
  - Conectar solo al namespace (`telepresence.connectNamespace`)
  - Desconectar del namespace (`telepresence.disconnectNamespace`)
  - Interceptar tráfico (`telepresence.interceptTraffic`)
  - Login simple a Kubernetes vía webview (`telepresence.loginToKubernetes`)
  - Instalación guiada de Telepresence, kubectl y kubelogin
  - Refrescar vistas (namespace, intercepciones, estado)
  - Auditoría de internacionalización (`I18nAuditor`)
- **Gestión visual mejorada**: Más feedback y notificaciones en cada acción.
- **Verificación automática de prerequisitos**: Al activar la extensión se verifica la instalación de herramientas necesarias y se ofrecen opciones de instalación.
- **Soporte ampliado para kubelogin**: Recomendado para cualquier cluster Kubernetes, no solo Azure.
- **Notificaciones y Registros Detallados**: Recibe mensajes, advertencias y errores relevantes en tiempo real, con acceso a registros completos desde el panel de salida de VS Code.

## Instalación

1. Instala la extensión desde VS Code Marketplace o descarga el archivo `.vsix` y usa la opción "Instalar desde VSIX" en VS Code.
2. Asegúrate de tener instaladas las siguientes herramientas (la extensión puede ayudarte a instalarlas):
   - [Telepresence](https://www.telepresence.io/docs/latest/install/)
   - [kubectl](https://kubernetes.io/docs/tasks/tools/)
   - [kubelogin](https://azure.github.io/kubelogin/) (opcional, solo para clústeres que requieren autenticación avanzada)

## Uso

1. Accede al comando `Telepresence: Iniciar sesión en Kubernetes` desde la paleta de comandos o haciendo clic en el estado del contexto en el panel de control.
2. Selecciona un contexto existente o configura uno nuevo utilizando la interfaz de inicio de sesión.
3. En el panel de control de Telepresence:
   - Conéctate a un espacio de nombres (paso 1)
   - Intercept el tráfico de un microservicio (paso 2)
   - Monitoriza el estado de Telepresence y las intercepciones activas
4. Utiliza las vistas de la barra de actividades para un acceso rápido a las funciones principales.

## Requisitos

- Visual Studio Code versión 1.74.0 o superior
- Telepresence 2.5.0 o superior
- kubectl instalado y configurado
- kubelogin (opcional, para autenticación avanzada)

## Documentación Adicional

Para obtener más información sobre cómo funciona Telepresence, consulta la [documentación oficial de Telepresence](https://www.telepresence.io/docs/latest/).

## Licencia

Este proyecto está bajo la Licencia MIT. Consulta el archivo [LICENSE.txt](LICENSE.txt) para más detalles.

## Créditos

Desarrollado por [Javier Frauca](https://github.com/JavierFrauca)
