package android.widget;
public interface Adapter { int getCount(); Object getItem(int i); long getItemId(int i); android.view.View getView(int p, android.view.View v, android.view.ViewGroup g); }
