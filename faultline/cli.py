"""
faultline/cli.py — Command-line interface for FaultLine forensics.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

app = typer.Typer(
    name="faultline",
    help="Agent failure forensics: backpropagation for agent failures via run graphs.",
    add_completion=False,
)
console = Console()


@app.command()
def investigate(
    trace_path: Path = typer.Argument(..., help="Path to OTel or TRAIL JSON trace file"),
    graph_name: str = typer.Option("demo_agent", "--graph", "-g", help="FalkorDB graph name"),
) -> None:
    """Investigate a failed agent trace to pinpoint root cause and generate a fix."""
    if not trace_path.exists():
        console.print(f"[bold red]Error:[/bold red] File not found: {trace_path}")
        raise typer.Exit(code=1)

    with console.status("[bold cyan]Loading trace and querying FalkorDB run graph..."):
        from faultline.graph import FaultLineGraph
        from faultline.ingest.otel import load_otel_file
        from faultline.investigator import investigate as run_investigation

        try:
            trace = load_otel_file(trace_path)
            g = FaultLineGraph(graph_name=graph_name)
            g.load_trace(trace)
            diag = run_investigation(trace, graph_name=graph_name)
        except Exception as e:
            console.print(f"[bold red]Investigation failed:[/bold red] {e}")
            raise typer.Exit(code=1)

    if not diag:
        console.print("[yellow]Investigation completed with no diagnosis.[/yellow]")
        return

    table = Table(title="Diagnosis Summary", border_style="cyan")
    table.add_column("Property", style="bold")
    table.add_column("Value")

    table.add_row("Run ID", diag.run_id)
    table.add_row("Failure Step (Symptom)", f"#{diag.failure_idx}")
    table.add_row("Root Cause Step", f"[bold green]#{diag.root_cause_idx}[/bold green]")
    table.add_row("Causal Path", " → ".join(f"#{i}" for i in diag.causal_path))
    table.add_row("Steps Evaluated", str(len(diag.steps_checked)))
    table.add_row("Replay Status", "[green]PASSED[/green]" if diag.replay_passed else "[red]FAILED[/red]")
    table.add_row("Tokens Used", f"{diag.tokens_used:,}")

    console.print(table)
    console.print(Panel(diag.explanation, title="Root Cause Explanation", border_style="green"))


@app.command()
def demo(
    fault: str = typer.Option("wrong_table", "--fault", "-f", help="Fault type (wrong_table, stale_cache, skip_currency, bad_filter, verifier_blind, no_fault)"),
    seed: Optional[int] = typer.Option(None, "--seed", "-s", help="Random seed"),
    out_dir: Path = typer.Option(Path("data/otel"), "--out-dir", "-o", help="Output directory for trace JSON"),
) -> None:
    """Run the 5-step demo agent pipeline with fault injection."""
    from demo_agent.agent import run_pipeline, save_trace_as_otel

    with console.status(f"[bold cyan]Running demo agent pipeline (fault={fault})..."):
        res = run_pipeline(fault_override=fault, seed=seed)
        saved_path = save_trace_as_otel(res["trace"], out_dir)

    console.print(f"[bold green]Demo run completed![/bold green]")
    console.print(f"Run ID: [cyan]{res['run_id']}[/cyan]")
    console.print(f"Fault injected: [yellow]{res.get('fault_name')}[/yellow]")
    console.print(f"Trace saved to: [underline]{saved_path}[/underline]")


@app.command()
def api(
    port: int = typer.Option(8000, "--port", "-p", help="Port to run FastAPI server on"),
    host: str = typer.Option("0.0.0.0", "--host", "-h", help="Host address"),
) -> None:
    """Start the FaultLine FastAPI server."""
    import uvicorn
    from faultline.api import app as fastapi_app

    console.print(f"[bold green]Starting FaultLine API server on {host}:{port}...[/bold green]")
    uvicorn.run(fastapi_app, host=host, port=port)


@app.command()
def ui(
    port: int = typer.Option(8501, "--port", "-p", help="Port to run Streamlit on"),
) -> None:
    """Launch the Streamlit web dashboard."""
    import subprocess
    import sys

    console.print(f"[bold green]Starting Streamlit UI on port {port}...[/bold green]")
    subprocess.run([sys.executable, "-m", "streamlit", "run", "ui/app.py", "--server.port", str(port)])


@app.command()
def evaluate(
    dataset: str = typer.Option("demo", "--dataset", "-d", help="Dataset name: demo, trail, or whowhen"),
    runs: int = typer.Option(20, "--runs", "-r", help="Number of runs to evaluate"),
    graph: str = typer.Option("eval", "--graph", "-g", help="FalkorDB graph name"),
) -> None:
    """Run the benchmark evaluation comparing FaultLine against baselines."""
    from eval.run_eval import run_eval

    console.print(f"[bold cyan]Starting evaluation on dataset '{dataset}' ({runs} runs)...[/bold cyan]")
    run_eval(dataset=dataset, max_runs=runs, graph_name=graph)


if __name__ == "__main__":
    app()
