<?php

namespace App\Filament\Resources\Tasks;

use App\Filament\Resources\Tasks\Pages\ManageTasks;
use App\Models\Task;
use Filament\Forms\Components\DateTimePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Form;
use Filament\Resources\Resource;
use Filament\Tables\Actions\BulkActionGroup;
use Filament\Tables\Actions\DeleteBulkAction;
use Filament\Tables\Actions\EditAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class TaskResource extends Resource
{
    protected static ?string $model = Task::class;

    protected static ?string $recordTitleAttribute = 'title';

    public static function form(Form $form): Form
    {
        return $form->schema([
            Select::make('work_order_id')->relationship('workOrder', 'name')->searchable()->preload(),
            TextInput::make('title')->maxLength(255),
            Textarea::make('description')->columnSpanFull(),
            TextInput::make('status')->default('open')->maxLength(255),
            Select::make('assigned_to')->relationship('assignedUser', 'name')->searchable()->preload(),
            DateTimePicker::make('due_date'),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('workOrder.name')->label('Work order')->searchable()->sortable(),
                TextColumn::make('title')->searchable()->sortable(),
                TextColumn::make('status')->badge()->sortable(),
                TextColumn::make('assignedUser.name')->label('Assigned to')->searchable(),
                TextColumn::make('due_date')->dateTime()->sortable(),
            ])
            ->filters([
                SelectFilter::make('status'),
            ])
            ->actions([
                EditAction::make(),
            ])
            ->bulkActions([
                BulkActionGroup::make([
                    DeleteBulkAction::make(),
                ]),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ManageTasks::route('/'),
        ];
    }
}
