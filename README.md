# PIW Nailo — versão experimental para Poke Idle World

Adaptado a partir do launcher **PIO Nailo / PIO Rebosteio** (créditos e licença MIT preservados no arquivo LICENSE).

## Objetivo
Manter a arquitetura leve em **Rust + Tauri + Microsoft Edge WebView2**, com até quatro contas, sem usar quatro processos Electron.

## Abrir no Windows
1. Extraia esta pasta integralmente.
2. Execute `Abrir PIW Nailo.bat` (usa `tools/launch-rust.vbs` e `tools/start-rust.ps1`).
3. O processo de compilação pode exigir Rust/Cargo, Visual Studio C++ Build Tools e WebView2 Runtime.
4. Também pode compilar manualmente com `cd rust-migration/src-tauri` e `cargo build`.

## Estado da migração
- URLs de abertura, verificações de host, permissões e origem alteradas para `https://poke.idleworld.online/play`.
- Preservada a arquitetura Rust/WebView2 e o gerenciamento de perfis do projeto original.
- **Ainda não testado em execução no Windows nem com login real**.
- A implementação headless original presume `wss://poke.idleworld.online/ws`, mas o endpoint e o protocolo do WebSocket **não foram verificados**. Essa parte pode não funcionar e exige análise específica do PIW.
- Recursos específicos do antigo PokeIdle (economia, HUD, combate, seletores e automação) podem necessitar adaptação ao PIW.
- Consumo de memória não foi medido. O uso de Rust/Tauri não garante sozinho consumo baixo em quatro WebViews.

## Publicar no GitHub
Crie um repositório novo chamado `piw-nailo-launcher`, público ou privado, sem README inicial. Extraia o ZIP e envie todo o conteúdo da pasta `piw-nailo` para esse repositório. Não envie dados de conta, senhas ou perfis pessoais.
