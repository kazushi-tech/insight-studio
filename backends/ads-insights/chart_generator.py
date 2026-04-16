
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import pandas as pd
from pathlib import Path
from typing import List, Optional

# Constants
FONT_NAME = "MS Gothic"

def configure_font():
    """Set Japanese font for matplotlib."""
    # Check if font exists
    found = False
    for f in fm.fontManager.ttflist:
        if f.name == FONT_NAME:
            found = True
            break
    
    if found:
        plt.rcParams['font.family'] = FONT_NAME
    else:
        # Fallback provided by matplotlib or OS, but try to set a generic sans-serif
        # that might support Japanese if configured in system
        pass

def _setup_figure(title: str):
    """Initialize figure with common settings."""
    configure_font()
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.set_title(title, fontsize=14)
    ax.grid(True, linestyle='--', alpha=0.6)
    return fig, ax

def plot_trend_cost_cv(df: pd.DataFrame, x_col: str, cost_col: str, cv_col: str, title: str, out_path: Path):
    """
    Generate Cost (Bar/Line) and CV (Line) trend chart.
    Usually Cost is bars or filled area, CV is line. Let's do 2 lines for simplicity as requested,
    or maybe Cost as Bar and CV as Line is better for visibility?
    User asked "Cost and CV Start (Line)". Let's stick to Line for both as requested 
    "Cost to CV no suii (oresen)". => Cost and CV trend (Line).
    """
    fig, ax1 = _setup_figure(title)

    # X-axis
    x = df[x_col].astype(str).tolist()
    
    # Cost (Left Axis)
    color1 = 'tab:blue'
    ax1.set_xlabel('Month')
    ax1.set_ylabel('Cost (円)', color=color1)
    ax1.plot(x, df[cost_col], color=color1, marker='o', label='Cost')
    ax1.tick_params(axis='y', labelcolor=color1)
    # Format Y axis for big numbers
    ax1.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{x:,.0f}'))

    # CV (Right Axis)
    ax2 = ax1.twinx() 
    color2 = 'tab:orange'
    ax2.set_ylabel('CV (件)', color=color2)
    ax2.plot(x, df[cv_col], color=color2, marker='s', label='CV')
    ax2.tick_params(axis='y', labelcolor=color2)

    # Handles for legend
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc='upper left')

    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_path)
    plt.close()

def plot_trend_cpa(df: pd.DataFrame, x_col: str, cpa_col: str, title: str, out_path: Path):
    """Generate CPA trend chart (Line)."""
    fig, ax = _setup_figure(title)
    
    x = df[x_col].astype(str).tolist()
    
    ax.set_ylabel('CPA (円)')
    ax.plot(x, df[cpa_col], color='tab:green', marker='^', label='CPA')
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{x:,.0f}'))
    
    ax.legend(loc='upper right')
    
    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_path)
    plt.close()

def plot_bar_media_cost_cv(df: pd.DataFrame, label_col: str, cost_col: str, cv_col: str, title: str, out_path: Path):
    """
    Generate Media/Campaign Cost/CV chart (Bar).
    We can do a grouped bar chart or dual axis bar/line.
    User asked "Media (or Campaign) Cost/CV (Bar)".
    Let's do a grouped bar chart.
    """
    fig, ax1 = _setup_figure(title)
    
    labels = df[label_col].astype(str).tolist()
    x = range(len(labels))
    width = 0.35
    
    # Cost (Left Axis, Bar)
    color1 = 'tab:blue'
    ax1.set_ylabel('Cost (円)', color=color1)
    bars1 = ax1.bar([i - width/2 for i in x], df[cost_col], width, label='Cost', color=color1, alpha=0.7)
    ax1.tick_params(axis='y', labelcolor=color1)
    ax1.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{x:,.0f}'))
    
    # CV (Right Axis, Bar or Line? Bar is requested)
    # If we do double bars on double axes it's confusing.
    # Usually Cost on Left (Bar) and CV on Right (Point/Line) is clearer, but request says "Bar".
    # Let's try grouped bars with dual axis.
    
    ax2 = ax1.twinx()
    color2 = 'tab:orange'
    ax2.set_ylabel('CV (件)', color=color2)
    bars2 = ax2.bar([i + width/2 for i in x], df[cv_col], width, label='CV', color=color2, alpha=0.7)
    ax2.tick_params(axis='y', labelcolor=color2)
    
    ax1.set_xticks(x)
    ax1.set_xticklabels(labels, rotation=45, ha='right')
    
    # Legend
    # Create combined legend
    ax1.legend([bars1, bars2], ['Cost', 'CV'], loc='upper left')
    
    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_path)
    plt.close()
