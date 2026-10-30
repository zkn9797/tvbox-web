package android.widget;
public abstract class BaseAdapter implements ListAdapter, SpinnerAdapter {
  public void notifyDataSetChanged() {} public void notifyDataSetInvalidated() {} public boolean hasStableIds() { return false; } public boolean isEmpty() { return getCount() == 0; }
  public int getViewTypeCount() { return 1; } public int getItemViewType(int p) { return 0; } public boolean areAllItemsEnabled() { return true; } public boolean isEnabled(int p) { return true; }
  public android.view.View getDropDownView(int p, android.view.View v, android.view.ViewGroup g) { return getView(p, v, g); }
}
