# Telepresence Plugin para VS Code

Esta extensión integra la potencia de Telepresence directamente en Visual Studio Code, permitiendo a los desarrolladores trabajar y depurar microservicios en Kubernetes de forma más ágil y visual. El objetivo es simplificar la experiencia de desarrollo remoto integrando herramientas clave en un único flujo de trabajo dentro del editor.

## Características Principales

- **Integración Nativa con Telepresence**: Ejecuta, gestiona y monitoriza sesiones de Telepresence sin salir de VS Code, facilitando el desarrollo y depuración de servicios que se ejecutan en Kubernetes.
- **Inicio de Sesión Simplificado en Clústeres Kubernetes**: Autentica y conecta con clústeres de múltiples proveedores (Azure AKS, GKE, EKS, local y genérico) con una interfaz intuitiva y pasos mínimos.
- **Soporte Avanzado de Autenticación**: Integración con kubelogin para autenticación moderna en clústeres que requieren Azure AD, OIDC y otros métodos de identidad.
- **Gestión Visual de Espacios de Nombres e Intercepciones**: Visualiza y gestiona conexiones a espacios de nombres e intercepciones de tráfico a través de una interfaz gráfica intuitiva y paneles dedicados.
- **Barra de Actividades Dedicada**: Accede rápidamente a todas las funcionalidades desde un panel lateral con vistas específicas para conexiones de espacios de nombres, intercepciones activas y estado del sistema.
- **Panel de Control Interactivo**: Interfaz web integrada para gestionar todas las funcionalidades de Telepresence con información en tiempo real.
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
