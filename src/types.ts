export type ToolMode = 'select' | 'build_line' | 'create_obj' | 'cut_line' | 'edit_obj' | 'joint';

export type PlacementState = { 
    type: 'static' | 'dynamic' | 'special' | 'joint', 
    shape?: 'circle' | 'box' | 'rounded_box' | 'capsule' | 'vesica' | 'spawn_point',
    subtype?: 'anchor' | 'distance' | 'inequality' | 'angular' | 'area'
} | null;
